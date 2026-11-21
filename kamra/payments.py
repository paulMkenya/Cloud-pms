"""Payment Links for folio settlement.

Lightweight by design: one REST call out, one webhook in. Which gateways a
property may use is its country pack's call (India: Razorpay, Cashfree);
this module decides what a link is for and posts the money, and never
speaks a gateway's API itself.
"""

import frappe
from frappe.utils import nowdate

from kamra.authz import require_roles


def _settings(property: str):
	name = frappe.db.get_value(
		"Payment Gateway Settings", {"property": property, "enabled": 1})
	if not name:
		frappe.throw(
			"No payment gateway configured for this property. "
			"Add API keys under Payment Gateway Settings."
		)
	return frappe.get_doc("Payment Gateway Settings", name)


def create_payment_link(folio_name: str, amount: float | None = None,
                        purpose: str = "Stay bill") -> dict:
	"""A link for the folio's balance - or, before arrival, for an explicit
	amount (a booking deposit), when the folio has no charges yet."""
	from kamra import localization as loc

	folio = frappe.get_doc("Folio", folio_name)
	if folio.status == "Closed":
		frappe.throw("Folio is closed.")
	amount = float(amount) if amount else float(folio.balance or 0)
	if amount <= 0:
		frappe.throw("Nothing due on this folio.")
	pack = loc.pack_for(folio.property)
	if not loc.payment_gateways(pack):
		frappe.throw("Online payment links are not available for this property's country.")
	settings = _settings(folio.property)
	guest = frappe.get_doc("Guest", folio.guest)
	currency = frappe.get_cached_value("Property", folio.property,
	                                   "currency") or loc.default_currency(pack)

	if settings.test_mode:
		# local demo: fake link, settle via the webhook simulator
		link_id = f"plink_TEST{frappe.generate_hash(length=10)}"
		url = loc.test_gateway_link(pack, settings.gateway, link_id)
	else:
		link_id, url = loc.create_gateway_link(
			pack, settings,
			amount=amount,
			currency=currency.upper(),
			reference=folio.name,
			description=" · ".join(x for x in (
				purpose,
				frappe.get_cached_value("Property", folio.property, "property_name") or folio.property,
				folio.reservation or folio.name,
				folio.guest_name) if x),
			customer={"name": guest.full_name, "contact": guest.phone or "",
			          "email": guest.email or ""},
			notes={"folio": folio.name, "property": folio.property},
		)

	folio.db_set("payment_link_id", link_id, update_modified=False)
	folio.db_set("payment_link_url", url, update_modified=False)
	folio.db_set("payment_link_amount", amount, update_modified=False)
	_remember_link(folio, link_id)

	from kamra.savings import log_action
	log_action("send_payment_link", "Folio", folio.name, folio.property,
	           minutes_saved=4,
	           rationale=f"{purpose} link {currency} {amount:,.0f} for {guest.full_name}",
	           channel="API")
	return {"url": url, "link_id": link_id, "amount": amount,
	        "currency": currency, "test_mode": bool(settings.test_mode)}


def _remember_link(folio, link_id: str) -> None:
	"""Keep every link id this folio has issued. A new link replaces
	payment_link_id, but disabling the old one at the gateway is
	best-effort - a guest who pays the superseded link must still land on
	this folio (see folio_for_link)."""
	if not link_id or not folio.meta.has_field("payment_link_history"):
		return
	ids = [i for i in (folio.get("payment_link_history") or "").split() if i]
	if link_id in ids:
		return
	ids.append(link_id)
	folio.db_set("payment_link_history", "\n".join(ids[-200:]),
	             update_modified=False)


def folio_for_link(link_id: str) -> str | None:
	"""The folio that issued a payment link - current or superseded."""
	if not link_id:
		return None
	name = frappe.db.get_value("Folio", {"payment_link_id": link_id}, "name")
	if name or not frappe.get_meta("Folio").has_field("payment_link_history"):
		return name
	# ids are opaque gateway tokens (cuid etc.); match a whole line
	for cand in frappe.get_all(
			"Folio", filters={"payment_link_history": ["like", f"%{link_id}%"]},
			fields=["name", "payment_link_history"], limit_page_length=5):
		if link_id in (cand.payment_link_history or "").split():
			return cand.name
	return None


def _confirm_paid_offer(res, amount: float) -> None:
	"""Confirm a paid offer if a room is still free. The payment itself is
	already posted and must survive a refused accept, hence the savepoint."""
	from kamra.booking_requests import _accept_request
	frappe.db.savepoint("paid_offer_accept")
	frappe.flags.kamra_trusted = True
	try:
		_accept_request(res.name)
	except Exception as e:
		frappe.db.rollback(save_point="paid_offer_accept")
		frappe.log_error(
			title=f"Paid offer could not be confirmed - rebook or refund {res.name}",
			message=f"KES {amount:,.2f} received; accept refused: {e}")
		try:
			from cloudtrade_hospitality.director_notify import alert_director
			alert_director(
				"a guest paid an offer but the room is no longer free",
				f"Received: KES {amount:,.0f}. The booking stays a request. "
				"Move it to another room/date or refund the guest.", res=res)
		except Exception:
			pass
	finally:
		frappe.flags.kamra_trusted = False


def _alert_paid_cancelled(res, amount: float, link_id: str) -> None:
	"""A link the guest opened before the booking was cancelled (declined,
	expired, cancelled by staff) can still be paid. The money stays posted
	on the folio; someone must refund or reinstate. Never raises."""
	try:
		frappe.log_error(
			title=f"Payment received on a cancelled booking - refund or rebook {res.name}",
			message=(f"KES {amount:,.2f} arrived through payment link {link_id} "
			         f"after {res.name} ({res.guest_name}) was cancelled "
			         f"({res.get('cancellation_note') or 'no note'}). It is posted "
			         "on the guest folio. Refund the guest or reinstate the booking."))
	except Exception:
		pass
	try:
		from cloudtrade_hospitality.director_notify import alert_director
		alert_director(
			"payment received on a cancelled booking",
			f"Received: KES {amount:,.0f}. {res.name} is Cancelled - refund the "
			"guest or rebook them.", res=res)
	except Exception:
		pass


def settle_payment_link(folio_name: str, link_id: str, amount: float) -> bool:
	"""Post money received through a link, once per link payment. Money that
	arrives before the guest does is an Advance on the booking: it counts
	toward the deposit and confirms a held booking."""
	folio = frappe.get_doc("Folio", folio_name)
	if amount <= 0 or any(p.reference == link_id for p in folio.payments):
		return False
	res = frappe.get_doc("Reservation", folio.reservation) \
		if folio.reservation else None
	pre_arrival = bool(res and res.status in (
		"Confirmed", "Pending Payment", "Held", "Requested"))
	folio.append("payments", {
		"posting_date": nowdate(),
		"payment_kind": "Advance" if pre_arrival else "Payment",
		"mode": "Payment Link",
		"amount": amount,
		"reference": link_id,
	})
	from kamra.folio import _recalculate
	_recalculate(folio)
	folio.save(ignore_permissions=True)
	try:
		from kamra.ledger import record_payment_ledger
		record_payment_ledger(folio, folio.payments[-1].as_dict())
	except Exception:
		frappe.log_error(title="ledger payment-link write failed")
	if pre_arrival:
		frappe.db.set_value("Reservation", res.name, "advance_paid",
		                    float(res.advance_paid or 0) + amount)
		if res.status in ("Pending Payment", "Held"):
			# money secures a held booking only once the deposit it owes
			# is covered - a token payment must not lock the inventory
			from kamra.api import _confirm_status, _deposit_state
			# re-read: the advance was just written under this document
			# (saving the stale copy raises TimestampMismatchError)
			res.reload()
			if _deposit_state(res)["due"] <= 0.005:
				_confirm_status(res)
		elif res.status == "Requested" and res.get("offer_pay_to_confirm"):
			# a pay-to-confirm offer holds no room: the payment confirms it
			# through the same inventory-checked accept a clerk runs
			res.reload()
			from kamra.api import _deposit_state
			if _deposit_state(res)["due"] <= 0.005:
				_confirm_paid_offer(res, amount)
	elif res and res.status == "Cancelled":
		_alert_paid_cancelled(res, amount, link_id)
	from kamra.savings import log_action
	log_action("payment_received", "Folio", folio.name, folio.property,
	           minutes_saved=3,
	           rationale=f"{amount:,.0f} {'deposit ' if pre_arrival else ''}"
	                     f"auto-posted from payment link",
	           agent_name="Payments", channel="API")
	try:
		from kamra.track import record as _track_click
		_track_click(
			"payment_received",
			property=(res.property if res else getattr(folio, "property", None)),
			reservation=res.name if res else None,
			reference=link_id, guest=res.guest if res else None,
			channel="link",
			meta={"amount": amount, "folio": folio.name})
	except Exception:
		pass
	return True


def handle_webhook(gateway: str, payload: bytes, headers: dict) -> dict:
	"""Settle a gateway's "link paid" event. Idempotent: a retried event
	never posts the same payment twice. A bad signature raises."""
	from kamra import localization as loc

	paid = loc.parse_payment_webhook(gateway, payload, headers, _settings)
	if not paid:
		return {"ignored": True}
	posted = settle_payment_link(paid["folio"], paid["link_id"], paid["amount"])
	return {"ok": True, "folio": paid["folio"], "posted": posted}


def _webhook(gateway: str) -> dict:
	headers = {k.lower(): v for k, v in (frappe.request.headers or {}).items()}
	out = handle_webhook(gateway, frappe.request.get_data() or b"{}", headers)
	frappe.db.commit()  # nosemgrep: frappe-manual-commit -- persists the completed operation before returning to an external/public caller; reviewed as intentional
	return out


@frappe.whitelist(allow_guest=True, methods=["POST"])
def razorpay_webhook():
	"""Razorpay calls this on payment_link.paid. Point the webhook at
	/api/method/kamra.payments.razorpay_webhook"""
	return _webhook("Razorpay")


@frappe.whitelist(allow_guest=True, methods=["POST"])
def cashfree_webhook():
	"""Cashfree posts here for every link (set per link as notify_url)."""
	return _webhook("Cashfree")


@frappe.whitelist()
@require_roles("Hotel Admin", "Finance")
def gateway_info(property: str, gateway: str = "") -> dict:
	"""What the Payments settings card shows beside the keys: where the
	gateway reports payments, and where to open an account."""
	from kamra import localization as loc

	pack = loc.pack_for(property)
	if not gateway:
		gateway = frappe.db.get_value("Payment Gateway Settings",
		                              {"property": property}, "gateway") \
			or (loc.payment_gateways(pack) or [""])[0]
	return loc.gateway_info(pack, gateway)
