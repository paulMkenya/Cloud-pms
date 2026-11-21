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
import re

import json

import frappe
from frappe import _
from frappe.utils import add_to_date, now_datetime

from kamra.authz import require_roles, restricted_properties

DEDUPE_MINUTES = 30

EVENTS = (
	"catalog_view", "listing_view",
	"booking_created", "inquiry_sent",
	"offer_view", "offer_accepted", "offer_declined",
	"payment_click", "payment_received",
	"checkin_view", "review_view", "review_submitted",
	"loyalty_view", "loyalty_enrolled", "loyalty_redeemed",
)


# page views only: link-preview fetchers, crawlers and scripted checks are
# not visitors (actions such as bookings and payments are always counted)
VIEW_EVENTS = {"catalog_view", "listing_view", "offer_view", "checkin_view",
               "review_view", "loyalty_view"}
_ROBOT = re.compile(r"(?i)bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|"
                    r"telegram|curl|wget|python-requests|headlesschrome|playwright")


def _is_robot() -> bool:
	try:
		req = getattr(frappe.local, "request", None)
		if req is None:
			return False
		ua = req.headers.get("User-Agent", "") if req.headers else ""
		ip = getattr(frappe.local, "request_ip", None) or req.remote_addr or ""
		return (not ua) or bool(_ROBOT.search(ua)) or ip in (frappe.conf.get("track_ignore_ips") or [])
	except Exception:
		return False


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


# ---------------------------------------------------------------------------
# visit context (no IP is stored: device from the user agent, source from
# the landing referrer / utm tags the guest page sends, region from the
# browser's time zone)
# ---------------------------------------------------------------------------

_TZ_REGION = {
	"Africa/Nairobi": "Kenya", "Africa/Kampala": "Uganda", "Africa/Dar_es_Salaam": "Tanzania",
	"Africa/Kigali": "Rwanda", "Africa/Addis_Ababa": "Ethiopia", "Africa/Mogadishu": "Somalia",
	"Africa/Juba": "South Sudan", "Africa/Lagos": "Nigeria", "Africa/Johannesburg": "South Africa",
	"Africa/Cairo": "Egypt", "Africa/Accra": "Ghana", "Europe/London": "United Kingdom",
	"Europe/Dublin": "Ireland", "Europe/Berlin": "Germany", "Europe/Paris": "France",
	"Europe/Amsterdam": "Netherlands", "Europe/Rome": "Italy", "Europe/Madrid": "Spain",
	"Asia/Dubai": "UAE", "Asia/Riyadh": "Saudi Arabia", "Asia/Qatar": "Qatar", "Asia/Kolkata": "India",
	"Asia/Shanghai": "China", "America/New_York": "USA (East)", "America/Chicago": "USA (Central)",
	"America/Los_Angeles": "USA (West)", "America/Toronto": "Canada", "Australia/Sydney": "Australia",
}
_REF_SOURCE = (
	(r"(^|\.)google\.", "Google"), (r"(^|\.)bing\.", "Bing"),
	(r"facebook\.com$|^fb\.|^l\.facebook|^m\.facebook|^lm\.facebook", "Facebook"),
	(r"instagram\.com$|^l\.instagram", "Instagram"), (r"wa\.me$|whatsapp", "WhatsApp"),
	(r"(^|\.)t\.co$|twitter\.com$|(^|\.)x\.com$", "X / Twitter"), (r"tiktok\.com$", "TikTok"),
	(r"airbnb\.", "Airbnb"), (r"booking\.com$", "Booking.com"), (r"linkedin\.com$", "LinkedIn"),
)


def _visit_meta() -> dict:
	try:
		req = getattr(frappe.local, "request", None)
		if req is None:
			return {}
		ua = (req.headers.get("User-Agent", "") if req.headers else "") or ""
		v = frappe.local.form_dict.get("_visit") if getattr(frappe.local, "form_dict", None) else None
		if isinstance(v, str):
			try:
				v = json.loads(v)
			except ValueError:
				v = {}
		v = v if isinstance(v, dict) else {}
		low = ua.lower()
		device = "Tablet" if ("ipad" in low or ("android" in low and "mobile" not in low)) \
			else "Mobile" if ("mobi" in low or "iphone" in low or "android" in low) else "Desktop"
		os_ = ("iOS" if ("iphone" in low or "ipad" in low) else "Android" if "android" in low
		       else "Windows" if "windows" in low else "macOS" if "mac os" in low
		       else "Linux" if "linux" in low else "Other")
		browser = ("Facebook app" if ("fban" in low or "fbav" in low or "fb_iab" in low)
		           else "Instagram app" if "instagram" in low else "TikTok app" if "tiktok" in low
		           else "Samsung" if "samsungbrowser" in low else "Edge" if "edg/" in low
		           else "Opera" if ("opr/" in low or "opera" in low) else "Firefox" if "firefox" in low
		           else "Chrome" if ("chrome" in low or "crios" in low) else "Safari" if "safari" in low
		           else "Other")
		ref = str(v.get("ref") or "")[:80].lower()
		utm = str(v.get("utm_source") or "")[:40]
		camp = str(v.get("utm_campaign") or "")[:60]
		if utm:
			source = utm
		elif v.get("fbclid"):
			source = "Facebook ad"
		elif v.get("gclid"):
			source = "Google ad"
		elif browser in ("Facebook app", "Instagram app", "TikTok app"):
			source = browser.replace(" app", "")
		elif ref:
			source = next((lab for pat, lab in _REF_SOURCE if re.search(pat, ref)), ref)
		else:
			source = "Direct / WhatsApp"
		tz = str(v.get("tz") or "")[:40]
		where = _TZ_REGION.get(tz) or (tz.split("/")[-1].replace("_", " ") if tz else "")
		out = {"dev": device, "os": os_, "br": browser, "src": source}
		if camp:
			out["camp"] = camp
		if where:
			out["where"] = where
		if v.get("lang"):
			out["lang"] = str(v.get("lang"))[:10]
		if v.get("page"):
			out["page"] = str(v.get("page"))[:120]
		return out
	except Exception:
		return {}


def record(event: str, property: str | None = None, reference: str = "",
           guest: str | None = None, reservation: str | None = None,
           channel: str = "web", meta: dict | None = None) -> None:
	"""Insert one Campaign Click. Silently no-ops on bad input or DB
	errors - tracking must never break the flow it observes."""
	try:
		if event not in EVENTS:
			return
		if event in VIEW_EVENTS and _is_robot():
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
		meta = {**(meta or {}), **_visit_meta()}
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

VIEW_TYPES = ("catalog_view", "listing_view")
DRILL_EVENTS = {
	"views": VIEW_TYPES,
	"payments": ("payment_received", "payment_click"),
	"offers": ("offer_view", "offer_accepted", "offer_declined"),
	"reviews": ("review_view", "review_submitted"),
	"loyalty": ("loyalty_view", "loyalty_enrolled", "loyalty_redeemed"),
}


def _window(days=None, from_date=None, to_date=None, preset=None):
	"""(start, end, label) for the screen's period. Dates are the site's
	own (Africa/Nairobi), so 'today' is the property's today."""
	from frappe.utils import add_days, get_datetime, getdate, nowdate
	today = getdate(nowdate())
	if preset == "today":
		a = b = today
	elif preset == "yesterday":
		a = b = add_days(today, -1)
	elif from_date or to_date:
		a = getdate(from_date or to_date)
		b = getdate(to_date or from_date)
		if b < a:
			a, b = b, a
		if (b - a).days > 366:
			frappe.throw(_("Pick a period of at most a year."))
	else:
		n = max(1, min(int(days or 30), 366))
		a, b = add_days(today, -(n - 1)), today
	return (get_datetime(f"{a} 00:00:00"), get_datetime(f"{b} 23:59:59.999999"), str(a), str(b))


def _scope(property):
	"""(sql where, args) limiting rows to the caller's properties."""
	if property:
		return " AND property = %s", [property]
	allowed = restricted_properties()
	if allowed is None:
		return "", []
	allowed = sorted(allowed) or ["__none__"]
	return " AND property IN ({})".format(", ".join(["%s"] * len(allowed))), list(allowed)


def _meta(details):
	try:
		return json.loads(details) if details else {}
	except ValueError:
		return {}


def _prop_names():
	return {p.name: p.property_name or p.name for p in frappe.get_all(
		"Property", fields=["name", "property_name"])}


def _top(counter: dict, n=8):
	return [{"label": k, "count": v} for k, v in sorted(counter.items(), key=lambda kv: -kv[1])[:n]]


@frappe.whitelist()
@require_roles("Hotel Admin", "Front Desk", "Kamra Agent")
def campaign_stats(property: str | None = None, days: int = 30, from_date: str | None = None,
                   to_date: str | None = None, preset: str | None = None):
	"""Funnel, per-property counts, breakdowns and recent clicks for the
	Campaigns screen, for any period (today, yesterday, last N days or a
	from-to range). A property-restricted user sees only their properties."""
	start, end, a, b = _window(days, from_date, to_date, preset)
	scope, sargs = _scope(property)
	where = "creation BETWEEN %s AND %s" + scope
	args = [start, end, *sargs]
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

	# bookings straight from the reservations made in the period (every
	# channel, tracked or not) - what "Bookings" drills into
	rscope, rargs = _scope(property)
	booked = {p: int(n) for p, n in frappe.db.sql(
		f"SELECT property, COUNT(*) FROM `tabReservation` WHERE creation BETWEEN %s AND %s{rscope} "
		"AND status NOT IN ('Waitlist') GROUP BY property", [start, end, *rargs])}

	sources, devices, regions, visitors = {}, {}, {}, set()
	for r in frappe.db.sql(
			f"SELECT details, reference FROM `tabCampaign Click` WHERE {where} "
			f"AND event IN ('catalog_view', 'listing_view') LIMIT 20000", args, as_dict=True):
		m = _meta(r.details)
		if r.reference:
			visitors.add(r.reference)
		if m.get("src"):
			sources[m["src"]] = sources.get(m["src"], 0) + 1
		if m.get("dev"):
			k = f"{m['dev']} · {m.get('br', '')}".strip(" ·")
			devices[k] = devices.get(k, 0) + 1
		if m.get("where"):
			regions[m["where"]] = regions.get(m["where"], 0) + 1

	rows = frappe.db.sql(
		f"SELECT property, event, channel, reference, guest, reservation, details, creation "
		f"FROM `tabCampaign Click` WHERE {where} ORDER BY creation DESC LIMIT 300", args, as_dict=True)
	prop_names = _prop_names()

	def funnel(counts, bookings=None):
		return {
			"views": counts.get("listing_view", 0) + counts.get("catalog_view", 0),
			"bookings": bookings if bookings is not None
			else counts.get("booking_created", 0) + counts.get("inquiry_sent", 0),
			"payments": counts.get("payment_received", 0),
			"offers_accepted": counts.get("offer_accepted", 0),
			"reviews": counts.get("review_submitted", 0),
			"loyalty": counts.get("loyalty_enrolled", 0) + counts.get("loyalty_redeemed", 0),
		}

	keys = set(per_prop) | set(booked)
	per_property = [
		{"property": p, "label": prop_names.get(p, p),
		 "counts": per_prop.get(p, {}),
		 "funnel": funnel(per_prop.get(p, {}), booked.get(p, 0) if p != "(all)" else 0)}
		for p in sorted(keys, key=lambda x: -(per_prop.get(x, {}).get("listing_view", 0) + booked.get(x, 0)))
	]
	recent = []
	for r in rows:
		m = _meta(r.details)
		ref = r.reference or ""
		recent.append({
			"when": str(r.creation), "property": r.property or "",
			"property_label": prop_names.get(r.property, r.property or "-"),
			"event": r.event, "channel": r.channel or "",
			"reference": "" if ref.startswith("v:") else ref,
			"visitor": ref if ref.startswith("v:") else "",
			"reservation": r.reservation or "", "guest": r.guest or "",
			"device": f"{m.get('dev', '')} · {m.get('br', '')}".strip(" ·"),
			"source": m.get("src", ""), "where": m.get("where", ""),
		})
	return {
		"from_date": a, "to_date": b,
		"days": (frappe.utils.getdate(b) - frappe.utils.getdate(a)).days + 1,
		"totals": totals, "funnel": funnel(totals, sum(booked.values())),
		"per_property": per_property, "recent": recent, "events": list(EVENTS),
		"unique_visitors": len(visitors),
		"breakdown": {"sources": _top(sources), "devices": _top(devices), "regions": _top(regions)},
	}


@frappe.whitelist()
@require_roles("Hotel Admin", "Front Desk", "Kamra Agent")
def campaign_drilldown(kind: str, property: str | None = None, days: int = 30,
                       from_date: str | None = None, to_date: str | None = None,
                       preset: str | None = None, visitor: str | None = None):
	"""The rows behind a number on the Campaigns screen.
	kind: views | bookings | payments | offers | reviews | loyalty | visitor."""
	start, end, a, b = _window(days, from_date, to_date, preset)
	prop_names = _prop_names()
	if kind == "bookings":
		scope, sargs = _scope(property)
		res = frappe.db.sql(
			f"SELECT name, guest_name, property, room_type, check_in_date, check_out_date, status, "
			f"source, channel, amount_after_tax, advance_paid, offer_token IS NOT NULL AS is_offer, creation "
			f"FROM `tabReservation` WHERE creation BETWEEN %s AND %s{scope} AND status NOT IN ('Waitlist') "
			f"ORDER BY creation DESC LIMIT 500", [start, end, *sargs], as_dict=True)
		return {"kind": kind, "from_date": a, "to_date": b, "rows": [{
			"when": str(r.creation), "reservation": r.name, "guest": r.guest_name,
			"property_label": prop_names.get(r.property, r.property),
			"check_in": str(r.check_in_date), "check_out": str(r.check_out_date),
			"status": r.status, "source": "Offer" if r.is_offer else (r.source or ""),
			"amount": float(r.amount_after_tax or 0), "paid": float(r.advance_paid or 0),
		} for r in res]}
	scope, sargs = _scope(property)
	where = "creation BETWEEN %s AND %s" + scope
	args = [start, end, *sargs]
	if kind == "visitor":
		if not (visitor or "").startswith("v:"):
			frappe.throw(_("Pick a visitor."))
		where += " AND reference = %s"
		args.append(visitor)
	else:
		events = DRILL_EVENTS.get(kind)
		if not events:
			frappe.throw(_("Unknown drill-down."))
		where += " AND event IN ({})".format(", ".join(["%s"] * len(events)))
		args.extend(events)
	rows = frappe.db.sql(
		f"SELECT event, property, reference, reservation, guest, details, channel, creation "
		f"FROM `tabCampaign Click` WHERE {where} ORDER BY creation DESC LIMIT 500", args, as_dict=True)
	visits = {}
	if kind in ("views", "visitor"):
		refs = sorted({r.reference for r in rows if (r.reference or "").startswith("v:")})
		if refs:
			visits = {k: int(n) for k, n in frappe.db.sql(
				"SELECT reference, COUNT(*) FROM `tabCampaign Click` WHERE reference IN ({}) "
				"AND creation BETWEEN %s AND %s GROUP BY reference".format(", ".join(["%s"] * len(refs))),
				[*refs, start, end])}
	out = []
	for r in rows:
		m = _meta(r.details)
		ref = r.reference or ""
		out.append({
			"when": str(r.creation), "event": r.event,
			"property_label": prop_names.get(r.property, r.property or "All properties"),
			"reservation": r.reservation or "", "guest": r.guest or "",
			"reference": "" if ref.startswith("v:") else ref,
			"visitor": ref if ref.startswith("v:") else "",
			"visits": visits.get(ref, 0),
			"device": m.get("dev", ""), "os": m.get("os", ""), "browser": m.get("br", ""),
			"source": m.get("src", ""), "campaign": m.get("camp", ""), "where": m.get("where", ""),
			"lang": m.get("lang", ""), "page": m.get("page", ""),
			"amount": m.get("amount") or m.get("value_kes"), "channel": r.channel or "",
		})
	return {"kind": kind, "from_date": a, "to_date": b, "rows": out}
