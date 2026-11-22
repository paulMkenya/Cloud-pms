# CloudTrade fork of Kamra (paulMkenya/Cloud-pms)

This is CloudTrade's private fork of Kamra. It runs `airbnb.cloudtrade.pro`
(Airbnbgems) alongside `cloudtrade_hospitality`, `cloudtrade_cloudpay` and
`cloudtrade_whatsapp`.

**Agents: read `apps/cloudtrade_hospitality/AGENTS.md` first.** It covers the
shared-bench rules, deploy steps, money flow, WhatsApp bot, scheduled jobs and
open items.

## Remotes and branches
* `upstream` = paulMkenya/Cloud-pms (private). Work on `develop`; `main` mirrors it.
* `kamra-upstream` = the public Kamra-PMS repo. **Never push there.**
* Run `npm run build` in `frontend/` only when shipping. It deploys immediately.
  Build commits contain `index.html` plus only the assets that build created.

## Fork-specific behaviour (not in upstream Kamra)
* **Whole-house lockout:** the kv setting `whole_house_lockout`. Any booking blocks
  every unit of the property (`reservation.villa_lockout_bookings`,
  `siu/availability`).
* **Pay-to-confirm online bookings:** the kv setting `unpaid_bookings_hold` = 0.
  `public_api.book()` creates them as `Requested` with `offer_pay_to_confirm`,
  and `offer_expires_on = now + hold_minutes`. The dates are checked free
  first. `book()` returns `pay_to_confirm` and `pay_within_minutes`.
* **Book now → CloudPay:** `PublicBooking.tsx` and `PublicListing.tsx` redirect
  straight to the payment link. `components/MpesaPay.tsx` (the STK box) is the
  fallback. The listing page has the same 30% / full choice as `/book`.
  "Send inquiry instead" was removed from `/book`.
* `payments.settle_payment_link(..., mode="Payment Link")` takes an optional mode.
  It is used for forwarded M-Pesa or bank payments.
* **Booking-requests inbox:** lists Inquiries as well. "Withdraw offer" is available.
* **Bill screen:** Invoice/Receipt PDFs and "Send on WhatsApp"
  (`cloudtrade_hospitality.folio_documents`).
* **Campaign tracking** (`track.py`, `/campaigns`): period presets, drill-downs,
  a robot filter, and one-view-per-load de-duplication.
* **`AppShell.tsx`:** the "Add to Home Screen" name and icon come from Website
  Settings `app_name` / `app_logo`.
* **Hold time setting:** `settings.py` has `unpaid_bookings_hold` (under "Holds & selling").

## Kamra Agent on Claude (2026-11-22)

`kamra/llm_anthropic.py` is a native Anthropic Messages API transport (official SDK).
`assistant._post_chat` hands the OpenAI-shaped body to it when the base URL is
api.anthropic.com and gets back a requests-like object, so `ask`, `ask_stream`,
`help_ask`, `_retry_text` and `test_connection` work unchanged. Claude's content blocks
(thinking/tool_use/fallback) ride on the assistant message as `_anthropic_content` and
are replayed verbatim within the tool loop. Model default `claude-opus-5-5`, effort
medium, server-side refusal fallback (`fallbacks: "default"`). New preset
"Anthropic (Claude)" in Settings → AI assistant; sk-ant keys are accepted there.
