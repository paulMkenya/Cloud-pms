# Copyright (c) 2026, HeyKoala and contributors
# For license information, please see license.txt

"""Staff -> guest booking offers.

A desk user prices a stay (usually at a negotiated rate), parks it as a
Request-to-Book stay and sends the guest an offer link. The offer holds
NO inventory - the room is only taken when the guest accepts, at which
point kamra.booking_requests._accept_request re-runs every inventory rule
under lock, exactly like a staff accept. Offers expire after a configurable
window (default 72h, max 14 days); an expired offer can no longer be
accepted and is lazily cancelled the next time it is touched.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_to_date, get_datetime, now_datetime

from kamra.authz import require_roles

DEFAULT_TTL_HOURS = 72
MAX_TTL_HOURS = 24 * 14


def _offer_url(token: str) -> str:
	base = frappe.utils.get_url().rstrip("/")
	# guest links go out over WhatsApp/SMS - emit https directly rather than
	# relying on the http->https redirect
	if base.startswith("http://") and "localhost" not in base \
			and "127.0.0.1" not in base:
		base = "https://" + base[len("http://"):]
	return f"{base}/kamra/offer/{token}"


def _find_by_token(token: str):
	name = frappe.db.get_value(
		"Reservation", {"offer_token": token}, "name")
	if not name:
		frappe.throw(_("This offer link isn't valid."),
		             title=_("Offer not found"))
	return frappe.get_doc("Reservation", name)


def _expired(res) -> bool:
	exp = res.get("offer_expires_on")
	return bool(exp) and get_datetime(exp) < get_datetime(now_datetime())


def _expire(res):
	"""Lazily close an offer whose window passed: cancel the Requested
	stay with no fee (it never held inventory) and free any room hint."""
	from frappe.model.naming import make_autoname

	res.status = "Cancelled"
	res.cancellation_reason = "Other"
	res.cancellation_note = "Offer expired before the guest responded"[:1000]
	res.cancellation_number = make_autoname("CXL-.YYYY.-.#####")
	res.cancellation_fee = 0
	res.cancelled_on = now_datetime()
	res.room = None
	frappe.flags.kamra_cancelling = True
	try:
		res.save(ignore_permissions=True)
	finally:
		frappe.flags.kamra_cancelling = False


@frappe.whitelist(methods=["POST"])
@require_roles("Front Desk", "Kamra Agent", "Hotel Admin", "System Manager")
def send_offer(reservation: str, expires_hours: int = DEFAULT_TTL_HOURS):
	"""Turn a Requested stay into a guest offer: mint the token, set the
	expiry and send the WhatsApp/SMS link through the guest templates.
	Safe to call again - it re-sends with a fresh expiry."""
	from kamra.savings import log_action

	res = frappe.get_doc("Reservation", reservation)
	if res.status != "Requested":
		frappe.throw(
			_("{0} is {1} - an offer goes out on a pending request.").format(
				res.name, res.status),
			title=_("Not a booking request"))
	if not res.offer_token:
		res.offer_token = frappe.generate_hash(length=24)
	hours = max(1, min(int(expires_hours or DEFAULT_TTL_HOURS), MAX_TTL_HOURS))
	res.offer_expires_on = add_to_date(now_datetime(), hours=hours)
	res.save(ignore_permissions=True)

	notified = {"sent": False}
	try:
		from cloudtrade_hospitality import guest_templates
		rate = float(res.get("agreed_rate") or 0)
		ctx = guest_templates.booking_ctx(
			res,
			room_type=frappe.db.get_value("Room Type", res.room_type,
			                              "room_type_name") or res.room_type,
			rate_part=(f" · {res.agreed_rate:,.0f}/night"
			           if rate > 0 else ""),
			total=f"KES {float(res.amount_after_tax or 0):,.0f}",
			link=_offer_url(res.offer_token),
			expires=res.offer_expires_on.strftime("%d %b %Y, %H:%M"),
		)
		# reference=False: WhatsApp Message Log dedupes on (reference, TEXT)
		# and the booking-request alert already used it for this reservation
		notified = {"queued": True}
		frappe.enqueue(
			"cloudtrade_hospitality.guest_templates.send", queue="short",
			enqueue_after_commit=True, key="booking_offer", res=res.name,
			channels=("whatsapp", "sms"), reference=False, **ctx)
	except Exception:
		frappe.log_error(frappe.get_traceback(),
		                 f"offers.send_offer message {res.name}")

	log_action(
		"booking_offer_sent", "Reservation", res.name, res.property,
		rationale=f"Offer sent for {res.name} ({res.guest_name}) "
	          f"{res.check_in_date}→{res.check_out_date}, "
	          f"expires {res.offer_expires_on}",
	)
	return {"reservation": res.name, "offer_url": _offer_url(res.offer_token),
	        "expires_on": str(res.offer_expires_on), "notified": notified}


# ---------------------------------------------------------------------------
# Guest-facing offer page (/kamra/offer/<token>) - the only allow_guest part
# ---------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True)
def offer_context(token: str):
	"""What the guest sees on the offer page. Read-only."""
	res = _find_by_token(token)
	expired = _expired(res)
	prop_name = frappe.db.get_value(
		"Property", res.property, "property_name") or res.property
	rt_name = frappe.db.get_value("Room Type", res.room_type,
	                            "room_type_name") or res.room_type
	out = {
		"reservation": res.name,
		"status": res.status,
		"expired": expired,
		"property": prop_name,
		"guest_name": res.guest_name,
		"room_type": rt_name,
		"check_in_date": str(res.check_in_date),
		"check_out_date": str(res.check_out_date),
		"nights": res.nights or 0,
		"adults": res.adults or 0,
		"children": res.children or 0,
		"total": float(res.amount_after_tax or 0),
		"expires_on": str(res.offer_expires_on) if res.get(
			"offer_expires_on") else None,
		"special_requests": res.get("special_requests"),
	}
	rate = float(res.get("agreed_rate") or 0)
	if rate > 0:
		out["nightly_rate"] = rate
	return out


@frappe.whitelist(allow_guest=True, methods=["POST"])
def respond_offer(token: str, accept: int):
	"""The guest's yes/no on the offer. Accept runs the exact same
	inventory-checked confirmation a staff accept does; decline cancels the
	request with no fee and no guest-facing 'we declined you' message."""
	res = _find_by_token(token)
	if _expired(res):
		_expire(res)
		frappe.db.commit()
		frappe.throw(_("This offer has expired."),
		             title=_("Offer expired"))
	if res.status != "Requested":
		# idempotent: a double-tap or a refresh after the decision lands here
		if res.status == "Confirmed" and int(accept or 0):
			return {"accepted": True, "reservation": res.name,
			        "status": res.status, "already": True}
		frappe.throw(_("This offer is no longer pending ({0}).").format(
			res.status), title=_("Offer closed"))

	if int(accept or 0):
		from kamra.booking_requests import _accept_request
		# the token IS the authorization: possession of the offer link lets
		# the guest run the same inventory-checked accept a clerk would
		frappe.flags.kamra_trusted = True
		try:
			out = _accept_request(res.name)
		finally:
			frappe.flags.kamra_trusted = False
		return {"accepted": True, "reservation": res.name,
		        "status": "Confirmed", "room": out.get("room")}

	from kamra.booking_requests import _decline_request
	_decline_request(res.name, _("Guest declined the offer"), notify=False)
	return {"accepted": False, "reservation": res.name,
	        "status": "Cancelled"}
