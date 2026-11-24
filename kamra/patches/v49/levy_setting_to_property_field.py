"""Cloud PMS fork: our kv setting room_levy_inclusive ("Displayed rates include
the levy", all-in Kenyan rate cards) is replaced by upstream 2.8.1's Property
field rates_include_levy, which backs the levy out of the displayed rate.
Carry each property's choice across so its prices stay exactly the same."""
import json

import frappe


def execute():
	if not frappe.db.has_column("Property", "rates_include_levy"):
		return
	for row in frappe.get_all("Property Setting", filters={"setting_key": "room_levy_inclusive"},
	                          fields=["property", "value"]):
		try:
			on = bool(json.loads(row.value))
		except (TypeError, ValueError):
			on = str(row.value).strip().lower() in ("1", "true", "yes")
		if on and frappe.db.exists("Property", row.property):
			frappe.db.set_value("Property", row.property, "rates_include_levy", 1, update_modified=False)
	frappe.clear_cache(doctype="Property")
