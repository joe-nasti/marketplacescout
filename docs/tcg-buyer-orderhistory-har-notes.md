# TCGplayer buyer Order History HAR notes

Source: `buyer-orderhistory.tcgplayer.com(1).har` captured 2026-08-24.

Confirmed authenticated Order History behavior:

- Initial page: `GET https://store.tcgplayer.com/myaccount/orderhistory` (may redirect through login revalidation before returning authenticated content).
- Range/search submission: `POST https://store.tcgplayer.com/MyAccount/OrderHistory` or lowercase equivalent with `application/x-www-form-urlencoded` body.
- Required form fields observed: `__RequestVerificationToken`, `ClearSessionFilters`, `SearchString`, `DateRange`.
- Observed range values: `Last 30 Days`, `Last 90 Days`, `Last 120 Days`, then individual years `2026` through `2016`.
- Pagination after a range is selected: `GET /myaccount/orderhistory?PageNumber=N` and relies on the authenticated server-side/session filter established by the prior POST.
- Filter reset: `GET /myaccount/orderhistory/clearfilters` (302 back to Order History).
- Search autocomplete: `/handler/autocomplete_orderhistory.ashx?...&s=<DateRange>...`; this is not needed for full-history synchronization.

Implementation consequence: historical backfill must submit the actual authenticated Order History form (including the anti-forgery token), then walk pagination while that server-side range filter is active. For `All available`, iterate the year options returned by the live authenticated page and de-duplicate by order number.

The supplied HAR does not contain authenticated navigations/responses for `/myaccount/messagecenter` or `/myaccount/storecredit`; it only exposes those links from the Order History account navigation. Message parsing should therefore remain disabled until a dedicated Message Center HAR is captured. Store-credit parsing can remain best-effort, but a dedicated Store Credit HAR is preferred before treating its ledger parser as final.
