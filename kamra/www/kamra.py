import json
import os
import re
from html import escape

import frappe
from frappe.utils import get_url, strip_html

# The SPA owns its own routing; never cache the boot shell.
no_cache = 1


def get_context(context):
	"""Serve the built React SPA shell with the session CSRF token injected.

	The front-end is built by Vite into kamra/public/frontend (served by Frappe
	at /assets/kamra/frontend/). We read that index.html at request time — so
	asset hashes never need to be hard-coded — and inject window.csrf_token so
	the SPA can POST to whitelisted endpoints once the user is logged in.
	"""
	index_path = frappe.get_app_path("kamra", "public", "frontend", "index.html")
	if not os.path.exists(index_path):
		frappe.throw(
			frappe._(
				"Kamra front-end is not built. Run "
				"<code>cd apps/kamra/frontend && yarn install && yarn build</code> "
				"(Frappe Cloud runs this automatically on deploy)."
			),
			title="Kamra not built",
		)

	with open(index_path, encoding="utf-8") as f:  # nosemgrep: frappe-security-file-traversal -- serves the app's own built index.html from a fixed app path, not user input
		html = f.read()

	csrf = frappe.sessions.get_csrf_token()
	# The socket.io namespace is the site name, which is not the hostname on
	# a custom domain - without it live updates silently never arrive.
	site = json.dumps(frappe.local.site).replace("<", "\\u003c")
	boot = f'<script>window.csrf_token = "{csrf}"; window.kamra_site = {site};</script>'
	# Inject before the module script so the token is set before the app boots.
	html = html.replace("</head>", boot + "</head>", 1)
	html = _with_meta(html, frappe.request.path if frappe.request else "/")

	context.spa_html = html
	context.no_cache = 1
	return context


# Link previews and most crawlers never run the SPA, so the guest pages get
# their title, description and image in the HTML itself. Staff screens and
# tokenized check-in links are kept out of search.
_GUEST = re.compile(r"^/(?:$|(?:kamra/)?book(?:/|$)|(?:kamra/)?stay/([^/]+))")


def _abs(path_or_url: str) -> str:
	"""An absolute https URL for share tags: previews (WhatsApp, Facebook)
	skip plain-http images, and behind the proxy get_url() can say http."""
	url = get_url(path_or_url) if path_or_url.startswith("/") else path_or_url
	host = url.split("/")[2] if url.startswith("http://") and url.count("/") >= 2 else ""
	if url.startswith("http://") and host.split(":")[0] not in ("localhost", "127.0.0.1") \
			and not host.endswith(".local"):
		url = "https://" + url[len("http://"):]
	return url


def _share_card() -> dict:
	"""The site's link-preview card (site_config "share_card": {image, title,
	description, site_name, width, height}). When it has an image, every
	shared link - booking site, listings, offer / payment / check-in links -
	previews with it, so WhatsApp and social shares always look the same."""
	card = frappe.conf.get("share_card")
	return card if isinstance(card, dict) else {}


def _image_tags(card: dict, image: str | None) -> list[str]:
	if not image:
		return []
	url = escape(_abs(image))
	tags = [f'<meta property="og:image" content="{url}" />',
	        f'<meta property="og:image:secure_url" content="{url}" />',
	        '<meta name="twitter:card" content="summary_large_image" />',
	        f'<meta name="twitter:image" content="{url}" />']
	if card.get("image") and image == card["image"]:
		tags += [f'<meta property="og:image:width" content="{int(card.get("width") or 1200)}" />',
		         f'<meta property="og:image:height" content="{int(card.get("height") or 630)}" />',
		         '<meta property="og:image:type" content="image/jpeg" />']
		if card.get("alt"):
			tags.append(f'<meta property="og:image:alt" content="{escape(card["alt"])}" />')
	return tags


def _card_tags(card: dict, path: str, title: str, description: str) -> list[str]:
	tags = [f'<meta property="og:title" content="{escape(title)}" />',
	        f'<meta property="og:description" content="{escape(description)}" />',
	        f'<meta property="og:url" content="{escape(_abs(path))}" />',
	        '<meta property="og:type" content="website" />',
	        f'<meta name="twitter:title" content="{escape(title)}" />',
	        f'<meta name="twitter:description" content="{escape(description)}" />']
	if card.get("site_name"):
		tags.append(f'<meta property="og:site_name" content="{escape(card["site_name"])}" />')
	return tags


def _with_meta(html: str, path: str) -> str:
	card = _share_card()
	match = _GUEST.match(path or "/")
	if not match:
		extra = '<meta name="robots" content="noindex" />'
		if card.get("site_name"):
			# the brand, not the software, in the tab and in any preview that
			# falls back to the page title
			html = re.sub(r"<title>.*?</title>", f"<title>{escape(card['site_name'])}</title>",
			              html, count=1, flags=re.S)
		if card.get("description"):
			html = re.sub(r'<meta\s+name="description"[^>]*>',
			              f'<meta name="description" content="{escape(card["description"])}" />',
			              html, count=1, flags=re.S)
		if card.get("image") and card.get("title"):
			# offer, payment, check-in and review links are shared on WhatsApp
			# too: same card, still kept out of search
			extra += "".join(_card_tags(card, path, card["title"], card.get("description") or "")
			                 + _image_tags(card, card["image"]))
		return html.replace("</head>", extra + "</head>", 1)
	meta = _guest_meta(match.group(1))
	if not meta:  # several hotels and none picked: the page lists them
		if not (card.get("title") and card.get("image")):
			return html
		meta = {"title": card["title"], "description": card.get("description") or "",
		        "image": card["image"]}
	if card.get("image"):
		meta["image"] = card["image"]
	if meta.get("lang"):
		html = re.sub(r'<html lang="[^"]*"', f'<html lang="{escape(meta["lang"])}"', html, count=1)
	html = re.sub(r"<title>.*?</title>", f"<title>{escape(meta['title'])}</title>", html, count=1, flags=re.S)
	html = re.sub(r'<meta\s+name="description"[^>]*>', "", html, count=1, flags=re.S)
	tags = [f'<meta name="description" content="{escape(meta["description"])}" />',
	        f'<link rel="canonical" href="{escape(_abs(path))}" />']
	tags += _card_tags(card, path, meta["title"], meta["description"])
	tags += _image_tags(card, meta.get("image"))
	return html.replace("</head>", "".join(tags) + "</head>", 1)


def _guest_meta(slug: str | None) -> dict | None:
	from kamra.booking_slugs import property_for_slug, resolve_public_slug

	listing = None
	listing_image = None
	try:
		if slug:
			scope = resolve_public_slug(slug)
			name = scope["property"]
			listing = scope.get("room_type_name")
			if scope.get("room_type"):
				# the unit's own photo makes the best share card; property
				# imagery is the fallback below
				row = frappe.db.sql(
					"""SELECT url FROM `tabRoom Type Media`
					   WHERE parent=%s AND (media_type='image'
					      OR url REGEXP '\\.(jpe?g|png|webp)$')
					   ORDER BY idx LIMIT 1""",
					scope["room_type"], as_dict=True)
				if row:
					listing_image = row[0].url
		else:
			name = property_for_slug(frappe.form_dict.get("property") or "")
			if not name:
				live = frappe.get_all("Property", {"booking_engine_enabled": 1, "disabled": 0},
				                      pluck="name", limit=2)
				if len(live) != 1:
					return None
				name = live[0]
	except frappe.DoesNotExistError:
		frappe.clear_last_message()
		return None
	prop = frappe.get_cached_doc("Property", name)
	place = ", ".join(x for x in (prop.city, prop.state) if x)
	title = prop.get("meta_title") or (
		f"{prop.property_name}{', ' + place if place else ''} · Book direct")
	if listing:
		title = f"{listing} · {prop.property_name}"
	description = (prop.get("meta_description")
	               or strip_html(prop.get("showcase_description") or "").strip()
	               or f"Book {prop.property_name}{' in ' + place if place else ''} directly with the hotel.")
	from kamra.languages import public_booking_language
	return {"title": title, "description": " ".join(description.split())[:160],
	        "lang": public_booking_language(prop.get("booking_language")),
	        "image": (listing_image or prop.get("og_image")
		          or prop.get("hero_image") or prop.get("logo_url"))}
