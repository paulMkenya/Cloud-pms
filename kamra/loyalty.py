# Copyright (c) 2026, CloudTrade Centralised Systems Limited
# For license information, please see license.txt

"""Loyalty programme - phone-enrolled points for BnB / serviced apartments.

Guests enrol on the public /kamra/loyalty page with their phone number.
Points are earned when a stay is Checked Out (never on booking, so
cancelled/unpaid stays earn nothing) and redeemed into single-use
Discount Vouchers for a chosen property. Every movement is a
Loyalty Transaction ledger row - the Guest.loyalty_points field is a
cache kept in step under a row lock.

Configuration lives in site_config.json under "loyalty":

    "loyalty": {
        "enabled": 1,
        "earn_divisor": 100,          # KES of eligible spend per point
        "redeem_kes_per_point": 5,    # KES off a future stay per point
        "min_redeem_points": 100,
        "enrol_bonus_points": 0,
        "earn_exclude_sources": ["OTA"],
        "voucher_valid_days": 90,
        "tiers": [{"min": 0, "label": "Member"},
                  {"min": 1000, "label": "Silver"},
                  {"min": 5000, "label": "Gold"}]
    }

Defaults: spend KES 100 -> 1 point; each point = KES 5 off a future
stay (~5% back); OTA-sourced stays earn nothing (the commission makes
points uneconomic - the guest still earns when they rebook direct).

Redemption security: the voucher code is delivered ONLY to the
enrolled phone over WhatsApp/SMS - the API response masks it. Anyone
who merely knows a guest's number can see a balance but cannot pull
their points.
"""

from __future__ import annotations

import re
import secrets

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import add_days, getdate, now_datetime, today

CONFIG_KEY = "loyalty"

DEFAULTS = {
	"enabled": 1,
	"earn_divisor": 100,
	"redeem_kes_per_point": 5,
	"min_redeem_points": 100,
	"enrol_bonus_points": 0,
	"earn_exclude_sources": ["OTA"],
	"voucher_valid_days": 90,
	"tiers": [
		{"min": 0, "label": "Member"},
		{"min": 1000, "label": "Silver"},
		{"min": 5000, "label": "Gold"},
	],
}

KINDS = ("Earn", "Enrol Bonus", "Redeem", "Adjust", "Expire")


# ---------------------------------------------------------------------------
# config + phone helpers
# ---------------------------------------------------------------------------

def _cfg() -> dict:
	c = dict(frappe.conf.get(CONFIG_KEY) or {})
	out = dict(DEFAULTS)
	out.update({k: v for k, v in c.items() if v is not None})
	return out


def _enabled() -> bool:
	return bool(int(_cfg().get("enabled") or 0))


def _digits(phone: str) -> str:
	return re.sub(r"\D", "", phone or "")


def _phone_key(phone: str) -> str:
	"""Last 9 digits - matches +2547XXXXXXXX, 07XXXXXXXX and 2547XXXXXXXX."""
	d = _digits(phone)
	return d[-9:] if len(d) >= 9 else d


def _find_guest(phone: str):
	"""Guest whose phone matches, preferring an enrolled profile then the
	most recently touched one. Phone formats vary (+254/07/spaces) so the
	match runs on the last-9-digit key in Python."""
	key = _phone_key(phone)
	if len(key) < 9:
		return None
	rows = frappe.get_all(
		"Guest",
		filters={"phone": ["!=", ""]},
		fields=["name", "first_name", "phone", "loyalty_points",
		        "loyalty_lifetime_points", "loyalty_enrolled_on",
		        "loyalty_tier"],
		order_by="modified desc",
	)
	matches = [g for g in rows if _phone_key(g.phone) == key]
	if not matches:
		return None
	matches.sort(key=lambda g: (bool(g.loyalty_enrolled_on),), reverse=True)
	return matches[0]


def _tier_for(lifetime: int) -> str:
	tiers = sorted(_cfg().get("tiers") or [],
	               key=lambda t: int(t.get("min") or 0), reverse=True)
	for t in tiers:
		if lifetime >= int(t.get("min") or 0):
			return t.get("label") or ""
	return ""


def _public_props():
	return frappe.get_all(
		"Property",
		filters={"booking_engine_enabled": 1, "disabled": 0},
		fields=["name", "property_name", "city"],
		order_by="property_name asc",
	)


def _status(guest=None, phone: str = "") -> dict:
	cfg = _cfg()
	if guest is None and phone:
		guest = _find_guest(phone)
	enrolled = bool(guest and guest.loyalty_enrolled_on)
	return {
		"ok": True,
		"enabled": _enabled(),
		"enrolled": enrolled,
		"name": (guest.first_name or "") if guest else "",
		"points": int(guest.loyalty_points or 0) if guest else 0,
		"lifetime": int(guest.loyalty_lifetime_points or 0) if guest else 0,
		"tier": (guest.loyalty_tier or "") if guest else "",
		"enrolled_on": str(guest.loyalty_enrolled_on) if guest and guest.loyalty_enrolled_on else "",
		"earn": {
			"divisor": int(cfg.get("earn_divisor") or 100),
			"text": _("1 point per KES {0} spent").format(
				f"{int(cfg.get('earn_divisor') or 100):,}"),
		},
		"redeem": {
			"kes_per_point": float(cfg.get("redeem_kes_per_point") or 5),
			"min_points": int(cfg.get("min_redeem_points") or 100),
			"voucher_days": int(cfg.get("voucher_valid_days") or 90),
		},
		"properties": [{"name": p.name,
		                "label": p.property_name or p.name,
		                "city": p.city or ""} for p in _public_props()],
	}


def _recent_txns(guest_name: str, limit: int = 10):
	rows = frappe.get_all(
		"Loyalty Transaction",
		filters={"guest": guest_name},
		fields=["posting_date", "kind", "points", "balance_after", "note"],
		order_by="creation desc", limit_page_length=limit,
	)
	return [{"date": str(r.posting_date), "kind": r.kind,
	         "points": int(r.points or 0),
	         "balance": int(r.balance_after or 0),
	         "note": r.note or ""} for r in rows]


# ---------------------------------------------------------------------------
# ledger
# ---------------------------------------------------------------------------

def _post(guest_name: str, points: int, kind: str, balance_after: int,
          property=None, reservation=None, voucher=None, note=""):
	if kind not in KINDS:
		frappe.throw(_("Unknown loyalty transaction kind."))
	doc = frappe.get_doc({
		"doctype": "Loyalty Transaction",
		"guest": guest_name,
		"property": property,
		"reservation": reservation,
		"voucher": voucher,
		"points": int(points),
		"kind": kind,
		"balance_after": int(balance_after),
		"posting_date": now_datetime(),
		"note": note,
	})
	doc.insert(ignore_permissions=True)


def _credit_locked(guest_name: str, delta: int) -> int:
	"""Apply a signed points delta under a row lock; returns new balance.
	Caller must be inside a transaction."""
	row = frappe.db.sql(
		"SELECT loyalty_points FROM `tabGuest` WHERE name = %s FOR UPDATE",
		guest_name)
	if not row:
		frappe.throw(_("Guest not found."))
	balance = int(row[0][0] or 0) + int(delta)
	if balance < 0:
		frappe.throw(_("Insufficient points."))
	frappe.db.set_value("Guest", guest_name, "loyalty_points", balance,
	                    update_modified=False)
	return balance


# ---------------------------------------------------------------------------
# earn on checkout
# ---------------------------------------------------------------------------

def on_reservation_update(doc, method=None):
	"""doc_events hook: award points once when a stay is Checked Out."""
	try:
		before = doc.get_doc_before_save()
		if not before or before.status == "Checked Out" \
				or doc.status != "Checked Out":
			return
		if not _enabled() or not doc.guest:
			return
		cfg = _cfg()
		if (doc.source or "") in (cfg.get("earn_exclude_sources") or []):
			return
		if frappe.db.exists("Loyalty Transaction",
		                    {"reservation": doc.name, "kind": "Earn"}):
			return  # idempotent - checkout hooks can re-fire
		guest = frappe.db.get_value(
			"Guest", doc.guest,
			["loyalty_enrolled_on", "loyalty_points",
			 "loyalty_lifetime_points"], as_dict=True)
		if not guest or not guest.loyalty_enrolled_on:
			return
		divisor = int(cfg.get("earn_divisor") or 100)
		pts = int(float(doc.amount_after_tax or 0)) // divisor if divisor else 0
		if pts <= 0:
			return
		balance = _credit_locked(doc.guest, pts)
		lifetime = int(guest.loyalty_lifetime_points or 0) + pts
		frappe.db.set_value("Guest", doc.guest,
		                    {"loyalty_lifetime_points": lifetime,
		                     "loyalty_tier": _tier_for(lifetime)},
		                    update_modified=False)
		_post(doc.guest, pts, "Earn", balance,
		      property=doc.property, reservation=doc.name,
		      note=f"Stay {doc.name} - KES {float(doc.amount_after_tax or 0):,.0f}")
		from cloudtrade_hospitality import guest_templates
		prop_name = frappe.db.get_value(
			"Property", doc.property, "property_name") or doc.property or ""
		guest_templates.send(
			"loyalty_points", doc, channels=("whatsapp", "sms"),
			reference=False,
			first=(doc.guest_name or "").split(" ")[0] or "there",
			property=prop_name,
			points_earned=f"{pts:,}",
			points=f"{balance:,}",
			balance=f"{balance:,}",
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(),
		                 f"loyalty.on_reservation_update {getattr(doc, 'name', '')}")


# ---------------------------------------------------------------------------
# public API (phone is the credential - see module docstring)
# ---------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=20, seconds=3600)
def loyalty_status(phone: str = ""):
	"""Balance + programme terms for a phone number. Unknown numbers get
	enrolled=False with no personal data."""
	if not _enabled():
		frappe.throw(_("The loyalty programme isn't running right now."))
	out = _status(phone=phone or "")
	if out["enrolled"]:
		guest = _find_guest(phone)
		out["recent"] = _recent_txns(guest.name)
	return out


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=3600)
def loyalty_enroll(phone: str = "", name: str = ""):
	"""Enrol a phone number. Idempotent: an already-enrolled number just
	returns its status. Creates a minimal Guest profile when none exists
	for the number (same as the booking flow does)."""
	if not _enabled():
		frappe.throw(_("The loyalty programme isn't running right now."))
	phone = (phone or "").strip()
	if len(_phone_key(phone)) < 9:
		frappe.throw(_("Enter a valid phone number (e.g. 0712 345 678)."))
	guest = _find_guest(phone)
	if not guest:
		first = (name or "").strip().split(" ")[0] or "Guest"
		last = " ".join((name or "").strip().split(" ")[1:])
		doc = frappe.get_doc({
			"doctype": "Guest",
			"first_name": first[:140],
			"last_name": last[:140],
			"phone": phone[:140],
			"marketing_consent": 0,
		})
		doc.insert(ignore_permissions=True)
		guest = frappe.db.get_value(
			"Guest", doc.name,
			["name", "first_name", "phone", "loyalty_points",
			 "loyalty_lifetime_points", "loyalty_enrolled_on",
			 "loyalty_tier"], as_dict=True)
	cfg = _cfg()
	bonus = int(cfg.get("enrol_bonus_points") or 0)
	if not guest.loyalty_enrolled_on:
		balance = _credit_locked(guest.name, bonus)
		frappe.db.set_value(
			"Guest", guest.name,
			{"loyalty_enrolled_on": today(),
			 "loyalty_tier": _tier_for(int(guest.loyalty_lifetime_points or 0) + bonus)},
			update_modified=False)
		_post(guest.name, bonus, "Enrol Bonus", balance,
		      note="Joined the loyalty programme")
		try:
			from cloudtrade_hospitality import guest_templates
			guest_templates.send_direct(
				"loyalty_enrolled", phone,
				first=guest.first_name or "there",
				points=f"{balance:,}", balance=f"{balance:,}",
				programme=_("the loyalty programme"),
				book_url=f"{frappe.utils.get_url().rstrip('/')}/kamra/book")
		except Exception:
			frappe.log_error(frappe.get_traceback(), "loyalty.enrol_notify")
	frappe.db.commit()  # nosemgrep: frappe-manual-commit -- public enrolment endpoint; persists before returning to external caller; reviewed as intentional
	guest = frappe.db.get_value(
		"Guest", guest.name,
		["name", "first_name", "phone", "loyalty_points",
		 "loyalty_lifetime_points", "loyalty_enrolled_on",
		 "loyalty_tier"], as_dict=True)
	out = _status(guest=frappe._dict(guest))
	out["recent"] = _recent_txns(guest.name)
	return out


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=3600)
def loyalty_redeem(phone: str = "", property: str = "", points: int = 0):
	"""Turn points into a single-use Discount Voucher for one property.
	The code is messaged to the enrolled phone only - the response shows
	a masked version so a stolen session can't lift the voucher."""
	if not _enabled():
		frappe.throw(_("The loyalty programme isn't running right now."))
	cfg = _cfg()
	phone = (phone or "").strip()
	guest = _find_guest(phone)
	if not guest or not guest.loyalty_enrolled_on:
		frappe.throw(_("This number isn't enrolled yet - join first."))
	points = int(points or 0)
	min_pts = int(cfg.get("min_redeem_points") or 100)
	if points < min_pts:
		frappe.throw(_("You need at least {0} points to redeem.").format(
			f"{min_pts:,}"))
	if not frappe.db.exists("Property", property or ""):
		frappe.throw(_("Pick a property for the voucher."))
	prop_name = frappe.db.get_value("Property", property, "property_name") or property

	kes_per_point = float(cfg.get("redeem_kes_per_point") or 5)
	value_kes = round(points * kes_per_point, 2)
	valid_days = int(cfg.get("voucher_valid_days") or 90)
	valid_to = add_days(getdate(today()), valid_days)

	# lock + re-check balance, then deduct and issue under one transaction
	balance = _credit_locked(guest.name, -points)
	code = _new_voucher_code()
	voucher = frappe.get_doc({
		"doctype": "Discount Voucher",
		"property": property,
		"voucher_code": code,
		"discount_type": "Amount",
		"value": value_kes,
		"valid_from": today(),
		"valid_to": valid_to,
		"min_nights": 1,
		"max_uses": 1,
		"times_used": 0,
		"disabled": 0,
	}).insert(ignore_permissions=True).name
	_post(guest.name, -points, "Redeem", balance,
	      property=property, voucher=voucher,
	      note=f"{points:,} pts -> KES {value_kes:,.0f} voucher {code}")
	try:
		from cloudtrade_hospitality import guest_templates
		book_url = f"{frappe.utils.get_url().rstrip('/')}/kamra/book?property=" \
			+ (frappe.db.get_value("Property", property, "page_slug") or "")
		guest_templates.send_direct(
			"loyalty_voucher", phone,
			first=guest.first_name or "there",
			points=f"{points:,}",
			value=f"KES {value_kes:,.0f}",
			code=code,
			valid_to=str(valid_to),
			property=prop_name,
			book_url=book_url)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "loyalty.redeem_notify")
	frappe.db.commit()  # nosemgrep: frappe-manual-commit -- persists redemption before returning to external caller; reviewed as intentional
	masked = code[:4] + "••" + code[-2:] if len(code) > 7 else "••••"
	return {
		"ok": True,
		"voucher": voucher,
		"code_masked": masked,
		"value_kes": value_kes,
		"points_used": points,
		"points_balance": balance,
		"valid_to": str(valid_to),
		"property": prop_name,
		"sent_to": _mask_phone(phone),
	}


def _new_voucher_code() -> str:
	alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	for _ in range(20):
		code = "LOY-" + "".join(secrets.choice(alphabet)
		                        for _ in range(6))
		if not frappe.db.exists("Discount Voucher", {"voucher_code": code}):
			return code
	frappe.throw(_("Could not allocate a voucher code - try again."))


def _mask_phone(phone: str) -> str:
	d = _digits(phone)
	return f"••• {d[-4:]}" if len(d) >= 4 else "•••"
