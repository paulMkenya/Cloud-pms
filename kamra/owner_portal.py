"""Owner portal - a property owner's own window into their units.

A "Property Owner" role sees only the properties they are linked to (User
Permissions on Property, or Property.owner_email matching their login) and
only read-only figures: a simple calendar of booked nights, the month's
earnings and a statement of what the operator owes them.

Money model (v1, documented on the statement itself):

    room revenue   = sum(Reservation.amount_before_tax) for stays whose
                     check-out falls in the month, excluding cancelled,
                     no-show and unpaid-pending stays
    OTA commission = sum(Reservation.commission_amount) on those stays
    management fee = room revenue x Property.owner_commission_pct / 100
    owner share    = room revenue - management fee - OTA commission

Taxes are the operator's remit and are not part of the owner split.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import getdate, nowdate

from kamra.authz import assert_property_access, require_roles, restricted_properties

OWNER_ROLES = ("Property Owner", "Hotel Admin", "System Manager",
               "Administrator")
# stays that never earned the owner anything
_DEAD = ("Cancelled", "No Show", "Pending Payment")


def _is_owner_only() -> bool:
	return "Property Owner" in frappe.get_roles() \
		and not ({"Hotel Admin", "System Manager", "Administrator"}
		         & set(frappe.get_roles()))


def _visible_properties() -> list[str]:
	"""Properties this login may see in the portal. An owner with no User
	Permissions sees nothing (fail closed) - the desk grants access."""
	perms = restricted_properties()
	if perms is None:
		if _is_owner_only():
			perms = set()
		else:
			perms = set(frappe.get_all("Property", pluck="name"))
	else:
		perms = set(perms)
	# owner_email on the Property is an extra link for owners the desk
	# hasn't given User Permissions to yet
	me = frappe.session.user
	email_props = set(frappe.get_all(
		"Property",
		filters={"owner_email": ("=", frappe.db.get_value("User", me, "email") or me)},
		pluck="name"))
	return sorted(perms | email_props)


def _check(property: str):
	allowed = set(_visible_properties())
	if property not in allowed:
		frappe.throw(_("You do not have access to this property."), frappe.PermissionError)
	assert_property_access(property)


def _commission_pct(property: str) -> float:
	return float(frappe.db.get_value("Property", property,
	                                 "owner_commission_pct") or 0)


@frappe.whitelist()
@require_roles(*OWNER_ROLES)
def owner_properties():
	"""The properties this login can see in the portal."""
	out = []
	for name in _visible_properties():
		p = frappe.db.get_value(
			"Property", name,
			["property_name", "owner_name", "owner_commission_pct"], as_dict=True)
		out.append({
			"name": name,
			"property_name": p.property_name,
			"owner_name": p.owner_name,
			"commission_pct": float(p.owner_commission_pct or 0),
			"units": frappe.db.count("Room", {"property": name}),
		})
	return {"properties": out}


@frappe.whitelist()
@require_roles(*OWNER_ROLES)
def owner_month(property: str, month: str):
	"""One calendar month of the owner's statement for a property.

	month = 'YYYY-MM'. Returns totals plus one row per earning stay."""
	_check(property)
	try:
		y, m = (int(x) for x in month.split("-"))
	except (ValueError, AttributeError):
		frappe.throw(_("Month must be YYYY-MM."))
	first, last = f"{y:04d}-{m:02d}-01", None
	from frappe.utils import add_months
	last = str(add_months(first, 1))[:10]

	rows = frappe.get_all(
		"Reservation",
		filters=[
			["property", "=", property],
			["status", "not in", list(_DEAD)],
			["check_out_date", ">=", first],
			["check_out_date", "<", last],
		],
		fields=["name", "guest_name", "room", "room_type",
		        "check_in_date", "check_out_date", "nights",
		        "amount_before_tax", "commission_amount", "status"],
		order_by="check_out_date asc")

	revenue = ota = 0.0
	lines = []
	for r in rows:
		amt = float(r.amount_before_tax or 0)
		comm = float(r.commission_amount or 0)
		revenue += amt
		ota += comm
		lines.append({
			"reservation": r.name,
			"guest_name": r.guest_name,
			"room": r.room,
			"check_in": str(r.check_in_date),
			"check_out": str(r.check_out_date),
			"nights": r.nights,
			"revenue": round(amt, 2),
			"ota_commission": round(comm, 2),
			"status": r.status,
		})
	pct = _commission_pct(property)
	fee = revenue * pct / 100.0
	owner = revenue - fee - ota
	return {
		"property": property,
		"month": month,
		"commission_pct": pct,
		"bookings": len(lines),
		"room_revenue": round(revenue, 2),
		"ota_commission": round(ota, 2),
		"management_fee": round(fee, 2),
		"owner_share": round(owner, 2),
		"lines": lines,
	}


@frappe.whitelist()
@require_roles(*OWNER_ROLES)
def owner_calendar(property: str, start_date: str | None = None, days: int = 42):
	"""A simple rooms x dates busy map for the owner's calendar strip.
	Confirmed/checked-in stays and active room blocks (incl. iCal imports)
	both mark nights as booked."""
	_check(property)
	start = getdate(start_date) if start_date else getdate(nowdate())
	end = frappe.utils.add_days(start, min(int(days or 42), 62))
	rooms = frappe.get_all(
		"Room", filters={"property": property},
		fields=["name", "room_number", "floor"], order_by="room_number asc")
	busy: dict[str, list[tuple]] = {r.name: [] for r in rooms}
	for res in frappe.get_all(
			"Reservation",
			filters={"property": property, "room": ("is", "set"),
			         "status": ("in", ["Confirmed", "Checked In", "Held"]),
			         "check_in_date": ("<", str(end)),
			         "check_out_date": (">", str(start))},
			fields=["room", "check_in_date", "check_out_date", "status",
			        "guest_name"]):
		if res.room in busy:
			busy[res.room].append((str(res.check_in_date), str(res.check_out_date),
			                        res.status, res.guest_name or ""))
	for blk in frappe.get_all(
			"Room Block",
			filters={"property": property, "room": ("is", "set"),
			         "block_status": "Active",
			         "from_date": ("<", str(end)),
			         "to_date": (">", str(start))},
			fields=["room", "from_date", "to_date", "reason"]):
		if blk.room in busy:
			busy[blk.room].append((str(blk.from_date), str(blk.to_date),
			                        "Block", blk.reason or "Blocked"))
	return {
		"property": property,
		"start": str(start), "days": int((end - start).days),
		"rooms": [{"name": r.name, "number": r.room_number, "floor": r.floor,
		           "busy": busy[r.name]} for r in rooms],
	}
