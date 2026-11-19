"""Public booking URL slugs — listing and site identifiers."""

from __future__ import annotations

import re

import frappe


def slugify(text: str) -> str:
	"""URL-safe slug from a display name."""
	s = (text or "").strip().lower()
	s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
	s = re.sub(r"[\s_]+", "-", s)
	s = re.sub(r"-+", "-", s).strip("-")
	return s or "listing"


def _public_property_slug(property: str) -> str:
	"""The slug catalog_index advertises for a property (page_slug or name)."""
	row = frappe.db.get_value(
		"Property", property, ["page_slug", "property_name"], as_dict=True,
	)
	if not row:
		return slugify(property)
	return (row.page_slug or "").strip() or slugify(row.property_name or property)


def _multi_property_site() -> bool:
	"""Several bookable properties share this site. Bare listing slugs like
	"1-bedroom" exist on every property, and /stay/<slug> resolves without
	a property in the path - so on these sites slugs get a property prefix.
	Single-property sites keep the short upstream URLs."""
	return frappe.db.count(
		"Property", {"booking_engine_enabled": 1, "disabled": 0},
	) > 1


def unique_listing_slug(property: str, base: str, exclude: str | None = None) -> str:
	"""Return *base* (property-prefixed on multi-property sites) or
	-2, -3, … — unique across ALL room types, because /stay/<slug>
	resolves globally, not within one property."""
	slug = slugify(base)
	if not slug:
		slug = "listing"
	prefix = f"{_public_property_slug(property)}-" if _multi_property_site() else ""
	used = set(
		frappe.get_all(
			"Room Type",
			filters={"name": ["!=", exclude]} if exclude else {},
			pluck="listing_slug",
		)
	)
	used.discard(None)
	used.discard("")
	candidate = prefix + slug
	if candidate not in used:
		return candidate
	for i in range(2, 200):
		candidate = f"{prefix}{slug}-{i}"
		if candidate not in used:
			return candidate
	return f"{prefix}{slug}-{frappe.generate_hash(length=6)}"


def location_slug_for(property: str, location_name: str) -> str:
	"""Slug for a booking "site" (a location grouping room types). Resolved
	globally like listing slugs, so it gets the same property prefix."""
	slug = slugify(location_name)
	if slug and _multi_property_site():
		return f"{_public_property_slug(property)}-{slug}"
	return slug


def ensure_room_type_slugs(room_type: str) -> None:
	"""Backfill listing_slug / location_slug on a Room Type if blank."""
	rt = frappe.get_doc("Room Type", room_type)
	changed = False
	if not (rt.get("listing_slug") or "").strip():
		rt.listing_slug = unique_listing_slug(rt.property, rt.room_type_name, exclude=rt.name)
		changed = True
	loc = (rt.get("location_name") or "").strip()
	if loc and not (rt.get("location_slug") or "").strip():
		rt.location_slug = location_slug_for(rt.property, loc)
		changed = True
	if changed:
		rt.db_set(
			{
				"listing_slug": rt.listing_slug,
				"location_slug": rt.get("location_slug"),
			},
			update_modified=False,
		)


def resolve_public_slug(slug: str) -> dict:
	"""Resolve a /stay/:slug path to property + listing or site scope."""
	slug = (slug or "").strip().lower()
	if not slug:
		frappe.throw("Listing not found.", frappe.DoesNotExistError)

	rt = frappe.db.get_value(
		"Room Type",
		{"listing_slug": slug, "disabled": 0},
		["name", "property", "room_type_name"],
		as_dict=True,
	)
	if rt:
		prop = frappe.db.get_value(
			"Property", rt.property, ["name", "booking_engine_enabled"], as_dict=True,
		)
		if not prop or not prop.booking_engine_enabled:
			frappe.throw("Listing not found.", frappe.DoesNotExistError)
		return {
			"kind": "listing",
			"property": rt.property,
			"listing_slug": slug,
			"room_type": rt.name,
			"room_type_name": rt.room_type_name,
		}

	site = frappe.db.sql(
		"""
		SELECT DISTINCT property, location_name
		FROM `tabRoom Type`
		WHERE disabled = 0 AND location_slug = %s
		LIMIT 1
		""",
		slug,
		as_dict=True,
	)
	if site:
		prop = frappe.db.get_value(
			"Property", site[0].property, ["name", "booking_engine_enabled"], as_dict=True,
		)
		if not prop or not prop.booking_engine_enabled:
			frappe.throw("Listing not found.", frappe.DoesNotExistError)
		return {
			"kind": "site",
			"property": site[0].property,
			"location_slug": slug,
			"location_name": site[0].location_name,
		}

	# a whole property on a multi-property site: /stay/<property-slug>
	prop_name = property_for_slug(slug)
	if prop_name:
		return {"kind": "property", "property": prop_name,
		        "property_slug": slug}

	frappe.throw("Listing not found.", frappe.DoesNotExistError)
	raise  # frappe.throw always raises; CodeQL does not treat it as noreturn


def property_for_slug(slug: str) -> str | None:
	"""The bookable Property whose public slug is *slug* - its page_slug, or
	the slug of its name when none is set (what catalog_index advertises).
	Only properties live on the booking engine resolve."""
	slug = (slug or "").strip().lower()
	if not slug:
		return None
	for p in frappe.get_all(
		"Property",
		filters={"booking_engine_enabled": 1, "disabled": 0},
		fields=["name", "property_name", "page_slug"],
		order_by="property_name asc",
	):
		if (p.page_slug or slugify(p.property_name)).lower() == slug:
			return p.name
	return None
