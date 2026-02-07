# Stripe Integration

## Overview

MyHelper uses Stripe for all payment processing:
- **Subscriptions**: Monthly billing for Basic and Pro plans
- **Deposits**: One-time payments for appointment deposits
- **Customer Portal**: Self-service billing management

## Environment Variables

```env
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASIC=price_...
STRIPE_PRICE_PRO=price_...
```

## Subscription Plans

| Plan | Features | Stripe Price ID |
|------|----------|-----------------|
| **Basic** | Salon management, bookings, clients, reports (no AI) | `STRIPE_PRICE_BASIC` |
| **Pro** | Everything in Basic + AI voice, business, content assistants | `STRIPE_PRICE_PRO` |

## Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/subscriptions/plans` | GET | List available plans |
| `/api/subscriptions/current` | GET | Current salon subscription |
| `/api/subscriptions/checkout` | POST | Create Stripe Checkout session |
| `/api/subscriptions/webhook` | POST | Handle Stripe webhooks |
| `/api/subscriptions/change-plan` | PUT | Upgrade/downgrade |
| `/api/subscriptions/cancel` | POST | Cancel subscription |
| `/api/subscriptions/payments` | GET | Payment history |
| `/api/subscriptions/portal` | POST | Open Stripe Customer Portal |

## Webhook Events

Handle these Stripe events:
- `checkout.session.completed` - Activate subscription after payment
- `customer.subscription.updated` - Plan changes
- `customer.subscription.deleted` - Cancellation
- `invoice.payment_succeeded` - Renewal confirmation
- `invoice.payment_failed` - Failed payment notification

## Security

- Always verify webhook signatures using `STRIPE_WEBHOOK_SECRET`
- Never log sensitive payment data
- Use Stripe Customer Portal for PCI-compliant billing management
- Store only Stripe customer/subscription IDs in the database

## Testing

Use Stripe test mode with test API keys from https://dashboard.stripe.com/test/apikeys
