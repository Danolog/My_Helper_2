## User Roles & Access

| Role | Permissions |
|------|------------|
| **owner** | Pelny dostep do dashboard, settings, reports, employees, promocje |
| **employee** | Wlasny kalendarz, podglad ogolny, galeria, swoje statystyki |
| **receptionist** | Umawianie wizyt, klienci, podglad kalendarza |
| **client** | Przegladanie salonow, rezerwacja, platnosci, opinie, ulubione |

## Database Schema (45 tabele)

- **Auth**: user, session, account, verification (text PKs)
- **Core**: salons, clients, employees, serviceCategories, services, serviceVariants, appointments, timeBlocks (UUID PKs)
- **Staff**: employeeServices, employeeServicePrices, workSchedules, employeeCommissions
- **Inventory**: products, productCategories, productUsage, serviceProducts, appointmentMaterials, treatmentHistory
- **Gallery**: galleryPhotos, albums, photoAlbums
- **Marketing**: promotions, promoCodes, loyaltyPoints, loyaltyTransactions, newsletters, marketingConsents, scheduledPosts
- **Notifications**: notifications, waitingList, temporaryAccess, pushSubscriptions
- **Payments**: subscriptionPlans, salonSubscriptions, subscriptionPayments, depositPayments, invoices, fiscalReceipts
- **AI & Other**: aiConversations, aiGeneratedMedia, favoriteSalons

## API Domains

- **AI (Pro)**: Business (alerts, analytics, chat, recommendations, categorize, search, insights), Content (descriptions, social-post, newsletter, auto-summary), Voice (book, cancel, reschedule, tts, stt, interpret-command, twilio), Image (generate, enhance, banner, service-illustration), Video (generate, status, story, testimonial-template), Usage monitoring
- **Core CRUD**: appointments, clients, employees, services, products, salons, gallery, invoices, promotions, promo-codes, reviews, work-schedules, time-blocks, waiting-list, scheduled-posts, temporary-access
- **Client Portal**: /api/client/appointments, reviews, waiting-list, /api/favorites/salons
- **Finance**: deposits, subscriptions, stripe webhooks, reports (revenue, occupancy, payroll, popularity, profitability, materials, promotions, cancellations, monthly/yearly comparison)
- **Notifications & Cron**: birthday, low-stock, we-miss-you, push, reminders, cron jobs
