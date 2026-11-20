"""Seed Folio.payment_link_history with the link each folio carries now,
so a payment on that link still matches once a newer link replaces it.
Safe to rerun."""

import frappe


def execute():
	frappe.reload_doc("kamra", "doctype", "folio")
	frappe.db.sql(
		"""update `tabFolio`
		set payment_link_history = payment_link_id
		where ifnull(payment_link_id, '') != ''
		  and ifnull(payment_link_history, '') = ''""")
