# Copyright (c) 2026, CloudTrade Centralised Systems Limited
# For license information, please see license.txt

"""Campaign click tracking - the mini analytics layer.

Every meaningful guest-side moment is written as a Campaign Click row:
property page views, booking creations, offer/payment/review/check-in
link opens, loyalty actions. Token-link endpoints double as the click
signal (opening /kamra/offer/<token> IS the click), so no client-side
beacon is needed and nothing can be faked into a conversion.

record() is fire-and-forget: it never raises into the booking or
payment path. Dedupe collapses refreshes - the same property+event+
reference inside DEDUPE_MINUTES counts once. Events recorded without a
reference (page views) get a per-visitor one, so each visitor counts
once per window rather than all anonymous visitors counting as one.
"""


from __future__ import annotations

import hashlib

import json

import frappe
from frappe import _
from frappe.utils import add_to_date, now_datetime

DEDUPE_MINUTES = 30

EVENTS = (
	"catalog_view", "listing_view",
	"booking_created", "inquiry_sent",
	"offer_view", "offer_accepted", "offer_declined",
	"payment_click", "payment_received",
	"checkin_view", "review_view", "review_submitted",
	"loyalty_view", "loyalty_enrolled", "loyalty_redeemed",
)


def _visitor_key() -> str:
	"""A short, non-reversible per-visitor key (client IP + user agent)."""
	try:
		req = getattr(frappe.local, "request", None)
		if req is None:
			return ""
		ip = getattr(frappe.local, "request_ip", None) or req.remote_addr or ""
		ua = req.headers.get("User-Agent", "") if req.headers else ""
		if not ip and not ua:
			return ""
		return "v:" + hashlib.sha256(f"{ip}|{ua}".encode()).hexdigest()[:16]
	except Exception:
		return ""


def record(event: str, property: str | None = None, reference: str = "",
           guest: str | None = None, reservation: str | None = None,
           channel: str = "web", meta: dict | None = None) -> None:
	"""Insert one Campaign Click. Silently no-ops on bad input or DB
	errors - tracking must never break the flow it observes."""
	try:
		if event not in EVENTS:
			return
		property = property or None
		reference = (reference or _visitor_key())[:140]
		# refresh-spam guard: same property+event+reference within the
		# window is the same click, not a new one
		since = add_to_date(now_datetime(), minutes=-DEDUPE_MINUTES)
		conds = ["event = %s", "creation >= %s"]
		args = [event, since]
		for col, val in (("property", property), ("reference", reference)):
			if val:
				conds.append(f"{col} = %s")
				args.append(val)
			else:
				conds.append(f"{col} IS NULL")
		if frappe.db.sql(
				f"SELECT name FROM `tabCampaign Click` WHERE {' AND '.join(conds)} LIMIT 1",
				args):
			return
		frappe.get_doc({
			"doctype": "Campaign Click",
			"property": property,
			"event": event,
			"channel": channel,
			"reference": reference or None,
			"guest": guest or None,
			"reservation": reservation or None,
			"details": json.dumps(meta)[:1500] if meta else None,
		}).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(frappe.get_traceback(),
		                 f"track.record {event}")


# ---------------------------------------------------------------------------
# staff report
# ---------------------------------------------------------------------------

def campaign_stats(property: str | None = None, days: int = 30):
	"""Funnel + recent clicks for the Campaigns screen. days capped at 180."""
	from kamra.authz import require_roles
	require_roles("Hotel Admin", "Front Desk", "Kamra Agent", "System Manager")
	days = max(1, min(int(days or 30), 180))
	since = add_to_date(now_datetime(), days=-days)

	filters = {"creation": [">=", since]}
	if property:
		filters["property"] = property

	# counts come from the database, whole window - not from a capped page
	where, args = "creation >= %s", [since]
	if property:
		where += " AND property = %s"
		args.append(property)
	per_prop: dict[str, dict] = {}
	totals: dict[str, int] = {}
	for prop_, event, n in frappe.db.sql(
			f"SELECT property, event, COUNT(*) FROM `tabCampaign Click` "
			f"WHERE {where} GROUP BY property, event", args):
		p = prop_ or "(all)"
		n = int(n or 0)
		bucket = per_prop.setdefault(p, {})
		bucket[event] = bucket.get(event, 0) + n
		totals[event] = totals.get(event, 0) + n

	rows = frappe.get_all(
		"Campaign Click",
		filters=filters,
		fields=["property", "event", "channel", "reference", "guest",
		        "reservation", "creation"],
		order_by="creation desc",
		limit_page_length=300,
	)

	props = frappe.get_all(
		"Property", filters={"disabled": 0},
		fields=["name", "property_name"], order_by="property_name")
	prop_names = {p.name: p.property_name or p.name for p in props}

	def funnel(counts):
		return {
			"views": counts.get("listing_view", 0) + counts.get("catalog_view", 0),
			"bookings": counts.get("booking_created", 0) + counts.get("inquiry_sent", 0),
			"payments": counts.get("payment_received", 0),
			"offers_accepted": counts.get("offer_accepted", 0),
			"reviews": counts.get("review_submitted", 0),
			"loyalty": counts.get("loyalty_enrolled", 0) + counts.get("loyalty_redeemed", 0),
		}

	per_property = [
		{"property": p,
		 "label": prop_names.get(p, p),
		 "counts": per_prop.get(p, {}),
		 "funnel": funnel(per_prop.get(p, {}))}
		for p in sorted(per_prop, key=lambda x: -(per_prop[x].get("listing_view", 0)
		                                           + per_prop[x].get("booking_created", 0)))
	]
	recent = [{
		"when": str(r.creation),
		"property": r.property or "",
		"property_label": prop_names.get(r.property, r.property or "-"),
		"event": r.event,
		"channel": r.channel or "",
		# per-visitor dedupe keys mean nothing to staff
		"reference": "" if (r.reference or "").startswith("v:") else (r.reference or ""),
		"reservation": r.reservation or "",
		"guest": r.guest or "",
	} for r in rows[:300]]

	return {
		"days": days,
		"totals": totals,
		"funnel": funnel(totals),
		"per_property": per_property,
		"recent": recent,
		"events": list(EVENTS),
	}
