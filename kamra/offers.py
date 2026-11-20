# Copyright (c) 2026, HeyKoala and contributors
# For license information, please see license.txt

"""Staff -> guest booking offers.

A desk user prices a stay (usually at a negotiated rate) and sends the
guest an offer link with the full stay details. Two offer shapes:

- Pay-to-confirm (the desk default): the stay is a Pending Payment
  booking - inventory is held for the payment window (default 2h,
  configurable to 14 days). The guest pays the deposit or the full
  amount through a CloudPay link; the payment webhook confirms the
  booking. Unpaid at expiry, expire_holds cancels it - "Hold / payment
  window expired".
- Free confirm: a Requested stay - the guest's accept runs the same
  lock-checked _accept_request a clerk would, taking inventory only
  then. Offer expiry cancels it lazily.

The offer_token is the guest's bearer secret for /kamra/offer/<token>;
the precheckin_token rides along for the payment-link endpoint.
"""

from __future__ import annotations

import math

import frappe
from frappe import _
from frappe.utils import add_to_date, get_datetime, now_datetime

from kamra.authz import require_roles

# pay-to-confirm: the window IS the inventory hold, keep it short
DEFAULT_TTL_HOURS = 2
# free-confirm (Requested): nothing is held, give the guest time to answer
DEFAULT_REQUEST_TTL_HOURS = 72
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
	"""Lazily close an unpaid Requested offer whose window passed: cancel
	the stay with no fee (it never held inventory) and free any room hint.
	Pending Payment offers are released by expire_holds on hold_expires_on
	instead - the scheduler owns that cancellation."""
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
def send_offer(reservation: str, expires_hours: int | None = None):
	"""Turn a Requested or Pending Payment stay into a guest offer: mint
	the token, (re)set the payment window and send the WhatsApp/SMS link
	through the guest templates. Safe to call again - it re-sends with a
	fresh window. On a Pending Payment stay the window is also the hold
	expiry, so an unpaid offer is released automatically."""
	from kamra.savings import log_action

	res = frappe.get_doc("Reservation", reservation)
	if res.status not in ("Requested", "Pending Payment"):
		frappe.throw(
			_("{0} is {1} - an offer goes out on a pending request or an "
			  "unpaid booking.").format(res.name, res.status),
			title=_("Not a booking request"))
	if not res.offer_token:
		res.offer_token = frappe.generate_hash(length=24)
	default = DEFAULT_TTL_HOURS if res.status == "Pending Payment" \
		else DEFAULT_REQUEST_TTL_HOURS
	hours = max(1, min(int(expires_hours or default), MAX_TTL_HOURS))
	deadline = add_to_date(now_datetime(), hours=hours)
	res.offer_expires_on = deadline
	if res.status == "Pending Payment":
		# the payment window IS the hold: unpaid offers release themselves
		res.hold_expires_on = deadline
	res.save(ignore_permissions=True)

	notified = {"sent": False}
	try:
		from cloudtrade_hospitality import guest_templates
		guest = frappe.db.get_value(
			"Guest", res.guest, ["phone"], as_dict=True) or {}
		rate = float(res.get("agreed_rate") or 0)
		ctx = guest_templates.booking_ctx(
			res,
			guest_name=res.guest_name or "",
			phone=guest.get("phone") or "",
			room_type=frappe.db.get_value("Room Type", res.room_type,
			                              "room_type_name") or res.room_type,
			rate_part=(f" · KES {rate:,.0f}/night" if rate > 0 else ""),
			# M-Pesa moves whole shillings and the link rounds up - quote
			# the guest the amount they will actually be asked to pay
			total=f"KES {math.ceil(float(res.amount_after_tax or 0) - 1e-6):,}",
			link=_offer_url(res.offer_token),
			expires=deadline.strftime("%d %b %Y, %H:%M"),
		)
		# reference=False: WhatsApp Message Log dedupes on (reference, TEXT)
		# and the booking-request alert already used it for this reservation
		# a Requested (free-confirm) offer holds nothing and is accepted,
		# not paid - it must not say "pay to confirm / held until"
		key = "booking_offer" if res.status == "Pending Payment" \
			else "booking_offer_request"
		frappe.enqueue(
			"cloudtrade_hospitality.guest_templates.send", queue="short",
			enqueue_after_commit=True, key=key, res=res.name,
			channels=("whatsapp", "sms"), reference=False, **ctx)
		notified = {"queued": True}
	except Exception:
		frappe.log_error(frappe.get_traceback(),
		                 f"offers.send_offer message {res.name}")

	log_action(
		"booking_offer_sent", "Reservation", res.name, res.property,
		rationale=f"Offer sent for {res.name} ({res.guest_name}) "
	          f"{res.check_in_date}→{res.check_out_date}, "
	          f"expires {deadline}",
	)
	return {"reservation": res.name, "offer_url": _offer_url(res.offer_token),
	        "expires_on": str(deadline), "notified": notified}


# ---------------------------------------------------------------------------
# Guest-facing offer page (/kamra/offer/<token>) - the only allow_guest part
# ---------------------------------------------------------------------------


def _deposit_ctx(res) -> dict:
	"""What the guest can pay to confirm: the deposit still due and the
	full remaining balance. Read-only figures from the same deposit state
	the desk and the payment-link endpoint use."""
	try:
		from kamra.api import _deposit_state
		state = _deposit_state(res)
		expected = float(state.get("expected") or 0)
		paid = float(state.get("paid") or 0)
		due = float(state.get("due") or 0)
		remaining = max(0.0, float(res.amount_after_tax or 0) - paid)
		return {"deposit_due": due, "deposit_expected": expected,
		        "paid": paid, "remaining": remaining}
	except Exception:
		return {"deposit_due": 0.0, "deposit_expected": 0.0,
		        "paid": 0.0, "remaining": float(res.amount_after_tax or 0)}


@frappe.whitelist(allow_guest=True)
def offer_context(token: str):
	"""What the guest sees on the offer page. Read-only."""
	res = _find_by_token(token)
	expired = _expired(res)
	from kamra.track import record as _track_click
	_track_click("offer_view", property=res.property,
	             reservation=res.name, reference=res.name, guest=res.guest,
	             channel="link")
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
		# the pre-arrival bearer token guest_payment_link expects - the
		# offer token already proves the guest may pay this booking
		"pay_token": res.precheckin_token,
		"cancel_note": res.get("cancellation_note")
		if res.status == "Cancelled" else None,
	}
	rate = float(res.get("agreed_rate") or 0)
	if rate > 0:
		out["nightly_rate"] = rate
	if res.status == "Pending Payment":
		out.update(_deposit_ctx(res))
	return out


def _money_received(res) -> float:
	"""What has come in against this booking: the pre-arrival advance and
	anything posted on its guest folio."""
	paid = float(res.get("advance_paid") or 0)
	folio_paid = frappe.db.get_value(
		"Folio", {"reservation": res.name, "folio_type": "Guest"},
		"payments_total") or 0
	return max(paid, float(folio_paid or 0))


def _alert_decline_with_money(res, received: float) -> None:
	frappe.log_error(
		title=f"Offer declined with payment received - refund or rebook {res.name}",
		message=(f"The guest tried to decline offer {res.name} ({res.guest_name}), "
		         f"but KES {received:,.2f} has already been received. The booking "
		         "was kept as it is. Contact the guest to cancel with a refund or "
		         "to confirm the stay."))
	try:
		from cloudtrade_hospitality.director_notify import alert_director
		alert_director(
			"guest declined an offer after paying",
			f"Received: KES {received:,.0f}. Booking kept as {res.status}. "
			"Call the guest to cancel + refund, or confirm the stay.", res=res)
	except Exception:
		pass
	try:
		from kamra.savings import log_action
		log_action("offer_decline_with_payment", "Reservation", res.name,
		           res.property,
		           rationale=f"Guest declined but KES {received:,.0f} received")
	except Exception:
		pass


@frappe.whitelist(allow_guest=True, methods=["POST"])
def respond_offer(token: str, accept: int):
	"""The guest's yes/no on a free (Requested) offer. A Pending Payment
	offer is confirmed by payment, not here - accept only completes it when
	the deposit is already covered; decline releases the hold with no fee."""
	res = _find_by_token(token)
	if _expired(res) and res.status == "Requested":
		_expire(res)
		frappe.db.commit()
		frappe.throw(_("This offer has expired."),
		             title=_("Offer expired"))

	if res.status == "Pending Payment":
		if int(accept or 0):
			from kamra.api import _confirm_status, _deposit_state
			if _deposit_state(res)["due"] > 0.005:
				frappe.throw(
					_("Payment is required to confirm this offer - use "
					  "the pay button."),
					title=_("Payment required"))
			_confirm_status(res)
			from kamra.track import record as _track_click
			_track_click("offer_accepted", property=res.property,
			             reservation=res.name, reference=res.name,
			             guest=res.guest, channel="link")
			frappe.db.commit()
			return {"accepted": True, "reservation": res.name,
			        "status": "Confirmed"}
		# money already received (part deposit by the desk or a link) must
		# not vanish with a no-fee cancel: keep the booking and send the
		# guest to the property, which refunds or rebooks
		received = _money_received(res)
		if received > 0.005:
			_alert_decline_with_money(res, received)
			frappe.db.commit()
			frappe.throw(
				_("A payment of KES {0} is already on this booking, so it "
				  "can't be cancelled here. Please contact the property to "
				  "cancel and arrange your refund.").format(f"{received:,.0f}"),
				title=_("Contact the property"))
		# decline: release the unpaid hold, no fee - same shape expire_holds
		# and the staff decline write
		from frappe.model.naming import make_autoname
		res.status = "Cancelled"
		res.cancellation_reason = "Other"
		res.cancellation_note = "Offer declined by guest"[:1000]
		res.cancellation_number = make_autoname("CXL-.YYYY.-.#####")
		res.cancellation_fee = 0
		res.cancelled_on = now_datetime()
		res.room = None
		frappe.flags.kamra_cancelling = True
		try:
			res.save(ignore_permissions=True)
		finally:
			frappe.flags.kamra_cancelling = False
		from kamra.track import record as _track_click
		_track_click("offer_declined", property=res.property,
		             reservation=res.name, reference=res.name,
		             guest=res.guest, channel="link")
		frappe.db.commit()
		return {"accepted": False, "reservation": res.name,
		        "status": "Cancelled"}

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
		from kamra.track import record as _track_click
		_track_click("offer_accepted", property=res.property,
		             reservation=res.name, reference=res.name,
		             guest=res.guest, channel="link")
		return {"accepted": True, "reservation": res.name,
		        "status": "Confirmed", "room": out.get("room")}

	from kamra.booking_requests import _decline_request
	_decline_request(res.name, _("Guest declined the offer"), notify=False)
	from kamra.track import record as _track_click
	_track_click("offer_declined", property=res.property,
	             reservation=res.name, reference=res.name,
	             guest=res.guest, channel="link")
	frappe.db.commit()
	return {"accepted": False, "reservation": res.name,
	        "status": "Cancelled"}
