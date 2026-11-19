"""CloudTrade Marketplace overlay (``ct_cloudtrade_marketplace`` site flag).

Flag off: the registry is byte-identical to upstream - every original
category and card, same order, same wording.
Flag on: Kenya/East-Africa cards appear, quote buttons get CloudTrade
routing metadata, and user-facing "Kamra" product names read "Cloud PMS".
"""

import unittest

import frappe

from kamra import marketplace

ORIGINAL_CATEGORIES = [
    "Kamra apps",
    "Guest messaging (WhatsApp)",
    "Distribution",
    "Bring your own AI",
    "Payments",
    "Accounting",
    "Country packs",
    "Kamra Enterprise",
]


class TestMarketplaceCloudTrade(unittest.TestCase):
	def setUp(self):
		self._old_flag = frappe.conf.get(marketplace.CLOUDTRADE_FLAG)
		self._old_email = frappe.conf.get("support_email")
		self._old_wa = frappe.conf.get("support_whatsapp")

	def tearDown(self):
		for key, val in (
			(marketplace.CLOUDTRADE_FLAG, self._old_flag),
			("support_email", self._old_email),
			("support_whatsapp", self._old_wa),
		):
			if val is None:
				frappe.conf.pop(key, None)
			else:
				frappe.conf[key] = val

	def _registry(self):
		return marketplace.registry("__no_such_property__")

	def _card_names(self, cats):
		return {c["name"] for cat in cats for c in cat["cards"]}

	def test_flag_off_is_upstream(self):
		frappe.conf.pop(marketplace.CLOUDTRADE_FLAG, None)
		cats = self._registry()
		self.assertEqual(
			[cat["category"] for cat in cats], ORIGINAL_CATEGORIES)
		names = self._card_names(cats)
		for expected in ("India", "Your country", "Kamra Enterprise",
		                 "Other channel managers"):
			self.assertIn(expected, names)
		for absent in ("Kenya", "Tanzania", "Uganda", "Rwanda", "M-Pesa",
		               "KRA eTIMS"):
			self.assertNotIn(absent, names)

	def test_flag_on_adds_kenya_and_east_africa(self):
		frappe.conf[marketplace.CLOUDTRADE_FLAG] = 1
		cats = self._registry()
		names = self._card_names(cats)
		for expected in ("Kenya", "Tanzania", "Uganda", "Rwanda",
		                 "M-Pesa", "KRA eTIMS",
		                 "M-Pesa Paybill/Till reconciliation"):
			self.assertIn(expected, names)
		# original cards all still present
		for expected in ("India", "Your country", "Cloud PMS Enterprise",
		                 "Other channel managers", "Channex.io"):
			self.assertIn(expected, names)

	def test_flag_on_renames_kamra_to_cloud_pms(self):
		frappe.conf[marketplace.CLOUDTRADE_FLAG] = 1
		cats = self._registry()
		for cat in cats:
			self.assertNotIn("Kamra", cat["category"])
			self.assertNotIn("Kamra", cat["blurb"])
			for c in cat["cards"]:
				self.assertNotIn("Kamra", c.get("name") or "")
				self.assertNotIn("Kamra", c.get("blurb") or "")

	def test_flag_on_keeps_card_order(self):
		"""Original relative order is preserved; new cards only lead
		Country packs (Kenya first) or append inside their section."""
		frappe.conf.pop(marketplace.CLOUDTRADE_FLAG, None)
		off = self._registry()
		frappe.conf[marketplace.CLOUDTRADE_FLAG] = 1
		on = self._registry()
		off_names = [c["name"] for cat in off for c in cat["cards"]
		             if c["name"] not in ("Kenya",)]
		on_names = [c["name"] for cat in on for c in cat["cards"]]
		# every original card still appears, in the same relative order
		pos = 0
		for name in off_names:
			mapped = name.replace("Kamra", "Cloud PMS")
			found = on_names.index(mapped, pos)
			pos = found + 1

	def test_flag_on_whatsapp_blurb_mentions_kenya(self):
		frappe.conf[marketplace.CLOUDTRADE_FLAG] = 1
		cats = self._registry()
		wa = next(c for c in cats if c["category"].startswith(
			"Guest messaging"))
		self.assertIn("Kenya and East Africa", wa["blurb"])
		# the original wording is kept, not replaced
		self.assertIn("India, Southeast Asia", wa["blurb"])

	def test_support_contact_disabled_by_default(self):
		frappe.conf.pop(marketplace.CLOUDTRADE_FLAG, None)
		self.assertEqual(
			marketplace.support_contact("__no_such_property__"),
			{"enabled": False})

	def test_support_contact_enabled(self):
		frappe.conf[marketplace.CLOUDTRADE_FLAG] = 1
		frappe.conf["support_email"] = "help@example.com"
		frappe.conf["support_whatsapp"] = "+254 700 000 000"
		out = marketplace.support_contact("__no_such_property__")
		self.assertTrue(out["enabled"])
		self.assertEqual(out["email"], "help@example.com")
		self.assertEqual(out["whatsapp"], "+254 700 000 000")
		self.assertEqual(out["property"], "__no_such_property__")

	def test_support_contact_defaults(self):
		frappe.conf[marketplace.CLOUDTRADE_FLAG] = 1
		frappe.conf.pop("support_email", None)
		frappe.conf.pop("support_whatsapp", None)
		out = marketplace.support_contact("__no_such_property__")
		self.assertEqual(out["email"], "support@cloudtrade.pro")
		self.assertEqual(out["whatsapp"], "254755000300")


if __name__ == "__main__":
	unittest.main()
