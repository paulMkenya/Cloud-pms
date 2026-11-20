"""Floors - the master behind Room.floor, and bulk room creation.

Room.floor stays the floor's NAME as text (a soft link), so every payload
and import that reads or writes it is unchanged. A Floor record gives the
name an order and a place to rename or retire it; Room.validate creates the
record the first time a name is used.
"""

import csv
import io
import re

import frappe
from frappe import _

from kamra.authz import assert_property_access, require_roles

_NUM = re.compile(r"-?\d+")
_OTHERS_BASE = 10000


def floor_number(name: str):
	"""The number in a floor name ("3", "Floor 3", "3rd"), or None."""
	m = _NUM.search(name or "")
	return int(m.group()) if m else None


def natural_key(name: str):
	"""Numbers by value, then everything else alphabetically."""
	n = floor_number(name)
	return (0, n, (name or "").lower()) if n is not None else (1, 0, (name or "").lower())


def default_sort_order(property: str, floor_name: str) -> int:
	"""Numbered floors sit at 10 x the number; others after the last of them,
	in the order they appear. The owner reorders from Admin > Floors."""
	n = floor_number(floor_name)
	if n is not None:
		return n * 10
	top = frappe.db.sql(
		"select max(sort_order) from `tabFloor` where property=%s", property)[0][0]
	return max(_OTHERS_BASE, (top or 0) + 10)


def ensure_floor(property: str, floor_name: str) -> str | None:
	"""Create the Floor for a name used on a room (and re-enable a disabled
	one). Returns the Floor's name, or None for a blank floor."""
	floor_name = (floor_name or "").strip()
	if not floor_name:
		return None
	name = frappe.db.get_value(
		"Floor", {"property": property, "floor_name": floor_name}, ["name", "disabled"],
		as_dict=True)
	if name:
		if name.disabled:
			frappe.db.set_value("Floor", name.name, "disabled", 0)
		return name.name
	doc = frappe.get_doc({
		"doctype": "Floor", "property": property, "floor_name": floor_name,
		"sort_order": default_sort_order(property, floor_name)})
	doc.insert(ignore_permissions=True)
	return doc.name


def floors_for(property: str) -> list:
	"""[{name, sort_order}] in board order, for the room boards' `floors`."""
	rows = frappe.get_all(
		"Floor", filters={"property": property, "disabled": 0},
		fields=["floor_name", "sort_order"])
	rows.sort(key=lambda r: (r.sort_order or 0, natural_key(r.floor_name)))
	return [{"name": r.floor_name, "sort_order": r.sort_order or 0} for r in rows]


def parse_range(start, end, prefix: str = "") -> list:
	"""Room numbers start..end (inclusive), each with the optional prefix."""
	try:
		a, b = int(start), int(end)
	except (TypeError, ValueError):
		frappe.throw(_("Enter the first and last room number as whole numbers."))
	if b < a:
		frappe.throw(_("The last room number must not be below the first."))
	if b - a >= 500:
		frappe.throw(_("Add at most 500 rooms at a time."))
	prefix = (prefix or "").strip()
	return [f"{prefix}{n}" for n in range(a, b + 1)]


@frappe.whitelist()
@require_roles("Hotel Admin")
def add_rooms(property: str, floor: str, room_type: str, start, end,
              prefix: str = "", preview=0):
	"""Create rooms start..end on a floor (numbers that already exist are
	skipped). preview=1 only reports what would happen. Admin > Rooms >
	Add rooms."""
	assert_property_access(property)
	numbers = parse_range(start, end, prefix)
	if frappe.db.get_value("Room Type", room_type, "property") != property:
		frappe.throw(_("Room type {0} does not belong to this property.").format(room_type))
	have = set(frappe.get_all(
		"Room", filters={"property": property, "room_number": ("in", numbers)},
		pluck="room_number"))
	new = [n for n in numbers if n not in have]
	skipped = [n for n in numbers if n in have]
	if not int(preview):
		for n in new:
			frappe.get_doc({
				"doctype": "Room", "property": property, "room_number": n,
				"room_type": room_type, "floor": (floor or "").strip()}).insert()
	return {"create": new, "skipped": skipped, "created": 0 if int(preview) else len(new)}


# ---------------------------------------------------------------------------
# CSV unit import + duplicate (Admin > Rooms)
# ---------------------------------------------------------------------------

_CSV_FIELDS = {
	"room_number": ("room_number", "number", "room", "unit"),
	"room_type": ("room_type", "type", "room type"),
	"floor": ("floor",),
	"housekeeping_status": ("housekeeping_status", "housekeeping", "hk_status"),
	"occupancy_status": ("occupancy_status", "occupancy"),
	"notes": ("notes", "note"),
	"wifi_name": ("wifi_name", "wifi name", "wifi_ssid"),
	"wifi_password": ("wifi_password", "wifi password", "wifi_pass"),
	"access_instructions": ("access_instructions", "access instructions", "access"),
	"house_rules": ("house_rules", "house rules"),
	"checkin_time": ("checkin_time", "check-in time", "checkin"),
	"checkout_time": ("checkout_time", "check-out time", "checkout"),
	"location_pin_url": ("location_pin_url", "pin url", "map link", "location"),
	"house_number": ("house_number", "house number", "address"),
}
_HK_OK = {"Clean", "Dirty", "Inspected", "Ready", "Out of Order"}
_OCC_OK = {"Vacant", "Occupied"}


def _csv_rows(csv_text: str) -> tuple[list[dict], list[str]]:
	"""Header-mapped rows + the list of recognised headers. Unknown columns
	are ignored; a missing room_number column is an error."""
	reader = csv.DictReader(io.StringIO(csv_text.lstrip("\ufeff")))
	if not reader.fieldnames:
		frappe.throw(_("The CSV has no header row."))
	norm = { (h or "").strip().lower(): h for h in reader.fieldnames }
	col = {}
	for field, aliases in _CSV_FIELDS.items():
		for a in aliases:
			if a in norm:
				col[field] = norm[a]
				break
	if "room_number" not in col:
		frappe.throw(_("The CSV needs a 'room_number' column "
		               "(aliases: number, room, unit)."))
	rows = []
	for r in reader:
		row = {f: (r.get(h) or "").strip() for f, h in col.items()}
		if row.get("room_number"):
			rows.append(row)
	return rows, list(col)


def _room_type_for_property(room_type_val: str, property: str) -> str | None:
	"""Resolve a CSV room_type value (Room name or room_type_name) to a
	Room Type of this property, or None."""
	val = (room_type_val or "").strip()
	if not val:
		return None
	types = frappe.get_all(
		"Room Type", filters={"property": property},
		fields=["name", "room_type_name", "room_type_code"])
	for rt in types:
		if val in (rt.name, rt.room_type_name, rt.room_type_code):
			return rt.name
	return "__missing__"


@frappe.whitelist()
@require_roles("Hotel Admin")
def import_units_csv(property: str, csv_text: str, preview=0):
	"""Create units from CSV rows. Existing room_numbers are skipped;
	bad rows are reported, never fatal. preview=1 reports only."""
	assert_property_access(property)
	rows, _cols = _csv_rows(csv_text or "")
	if not rows:
		frappe.throw(_("The CSV has no data rows."))
	if len(rows) > 500:
		frappe.throw(_("Import at most 500 units at a time."))
	numbers = [r["room_number"] for r in rows]
	have = set(frappe.get_all(
		"Room", filters={"property": property, "room_number": ("in", numbers)},
		pluck="room_number"))
	type_cache: dict[str, str | None] = {}
	prop_types = frappe.get_all(
		"Room Type", filters={"property": property}, pluck="name")
	default_type = prop_types[0] if len(prop_types) == 1 else None
	create, skipped, errors = [], [], []
	seen = set(have)
	for r in rows:
		n = r["room_number"]
		if n in seen:
			skipped.append(n)
			continue
		seen.add(n)
		rt_val = r.get("room_type") or ""
		if not rt_val and default_type:
			rt_val = default_type
		r.setdefault("room_type", rt_val)
		if rt_val not in type_cache:
			type_cache[rt_val] = _room_type_for_property(rt_val, property)
		rt = type_cache[rt_val]
		if rt in (None, "__missing__"):
			errors.append(f"{n}: unknown room type '{rt_val}'"
			              if rt_val else f"{n}: missing room_type")
			continue
		hk = r.get("housekeeping_status") or "Clean"
		if hk and hk not in _HK_OK:
			errors.append(f"{n}: bad housekeeping_status '{hk}'")
			continue
		occ = r.get("occupancy_status") or "Vacant"
		if occ and occ not in _OCC_OK:
			errors.append(f"{n}: bad occupancy_status '{occ}'")
			continue
		create.append(r)
	created_names = []
	if not int(preview):
		for r in create:
			rt = type_cache.get(r.get("room_type") or "")
			doc = {
				"doctype": "Room", "property": property,
				"room_number": r["room_number"],
				"floor": (r.get("floor") or "").strip(),
				"housekeeping_status": r.get("housekeeping_status") or "Clean",
				"occupancy_status": r.get("occupancy_status") or "Vacant",
			}
			if rt and rt != "__missing__":
				doc["room_type"] = rt
			for f in ("notes", "wifi_name", "wifi_password",
			          "access_instructions", "house_rules",
			          "checkin_time", "checkout_time",
			          "location_pin_url", "house_number"):
				if r.get(f):
					doc[f] = r[f]
			try:
				frappe.get_doc(doc).insert()
				created_names.append(r["room_number"])
			except Exception as e:
				errors.append(f"{r['room_number']}: {e}")
	return {"create": created_names if not int(preview)
	                     else [r["room_number"] for r in create],
	        "skipped": skipped, "errors": errors,
	        "created": len(created_names)}


@frappe.whitelist(methods=["POST"])
@require_roles("Hotel Admin")
def duplicate_unit(room: str, new_room_number: str):
	"""Clone a unit's setup (type, floor, guest access fields) under a new
	room number. Status starts Vacant/Clean - it has no history."""
	assert_property_access(frappe.db.get_value("Room", room, "property"))
	new_room_number = (new_room_number or "").strip()
	if not new_room_number:
		frappe.throw(_("Enter the new unit number."))
	prop = frappe.db.get_value("Room", room, "property")
	if frappe.db.exists("Room", {"property": prop,
	                             "room_number": new_room_number}):
		frappe.throw(_("Unit {0} already exists.").format(new_room_number))
	src = frappe.get_doc("Room", room)
	data = {f.fieldname: src.get(f.fieldname)
	        for f in src.meta.fields
	        if f.fieldtype not in ("Table", "Table MultiSelect", "Button",
                                "HTML", "Section Break", "Column Break",
                                "Tab Break")
	        and f.fieldname not in ("name", "room_number", "creation",
                                 "modified", "modified_by", "owner",
                                 "docstatus", "idx")}
	data.update({
		"doctype": "Room", "room_number": new_room_number,
		"occupancy_status": "Vacant", "housekeeping_status": "Clean",
	})
	new = frappe.copy_doc(src)
	for k, v in data.items():
		new.set(k, v)
	new.insert()
	return {"name": new.name, "room_number": new_room_number}
