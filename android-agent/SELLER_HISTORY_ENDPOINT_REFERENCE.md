# Seller History endpoint reference

Source of truth: the working authenticated Seller History Chrome extension (`tcgplayer-seller-history-analyzer-v0.2.3`) and Seller Portal reconnaissance. This project does **not** use TCGplayer's separately-approved public/official API.

## Authentication/session model

All requests rely on the user's existing signed-in TCGplayer browser/WebView session with credentials/cookies included. Do not introduce API keys, bearer tokens, arbitrary header injection, or separate TCGplayer developer API authentication.

## Current Seller Portal JSON surface

### Auth detail

`GET https://sp-api.tcgplayer.com/Account/auth-detail?api-version=1.0`

Used to obtain the authenticated Seller Portal account detail including the seller identity/key needed by order search.

### Search orders

`POST https://order-management-api.tcgplayer.com/orders/search?api-version=2.0`

Reference body:

```json
{
  "searchRange": "LastTwoYears",
  "filters": {
    "sellerKey": "<authenticated seller key>"
  },
  "sortBy": [
    {"sortingType": "orderDate", "direction": "descending"}
  ],
  "from": 0,
  "size": 1000
}
```

This POST is semantically read-only and is explicitly allowlisted by the Android probe policy.

### Order detail

`GET https://order-management-api.tcgplayer.com/orders/{orderNumber}?api-version=2.0`

### Export orders

`POST https://order-management-api.tcgplayer.com/orders/export?api-version=2.0`

Reference body wraps the search model plus `timezoneOffset`.

### Seller Portal resources observed by Android v0.1.9

- `GET .../orders/actionable-count?api-version=2.0`
- `GET .../products/lines?api-version=2.0`
- `GET https://seller-settings-api.tcgplayer.com/v1/settings?applicationId=sp_oms_settings_v1.0`

## Legacy authenticated store admin surface

These are normal signed-in `store.tcgplayer.com/admin` pages, HTML/CSV rather than the newer JSON OMS API.

- `/admin/RO?...` reimbursement invoice list
- `/admin/ro/details/{riNumber}`
- `/admin/RO/DiscrepanciesCSV/{riNumber}`
- `/admin/RO/DiscrepancyWidgetContent/{widgetId}`
- `/admin/payment/sellerpayment`
- `/admin/payment/loadpendingpayments`
- `/admin/payment/SellerPaymentOrders/{token}`
- `/admin/payment/PendingPaymentOrders?...`

## Executor requirements

The generic Android executor should support only:

1. allowlisted HTTPS navigation + bounded capture;
2. allowlisted authenticated GET;
3. allowlisted semantically-read-only POST for known search/export endpoints with bounded JSON bodies;
4. bounded response capture and status/error metadata.

It must reject arbitrary JavaScript, arbitrary hosts, arbitrary request headers, credential injection, and mutation endpoints/methods.
