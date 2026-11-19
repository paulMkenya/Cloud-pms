# Copyright (c) 2026, HeyKoala and contributors
# For license information, please see license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

import kamra.public_api


class TestUiLabels(FrappeTestCase):
	"""Tenant display-label overrides (site_config ui_label_overrides)."""

	def setUp(self):
		self._saved = frappe.conf.get("ui_label_overrides")

	def tearDown(self):
		if self._saved is None:
			frappe.conf.pop("ui_label_overrides", None)
		else:
			frappe.conf["ui_label_overrides"] = self._saved

	def test_empty_without_config(self):
		frappe.conf.pop("ui_label_overrides", None)
		self.assertEqual(kamra.public_api.ui_labels(), {})

	def test_returns_config_map(self):
		frappe.conf["ui_label_overrides"] = {"Hotel Policies & Rules": "House Rules"}
		self.assertEqual(
			kamra.public_api.ui_labels(), {"Hotel Policies & Rules": "House Rules"}
		)

	def test_non_dict_config_is_ignored(self):
		frappe.conf["ui_label_overrides"] = ["not", "a", "dict"]
		self.assertEqual(kamra.public_api.ui_labels(), {})
