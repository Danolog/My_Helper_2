import { pgTable, text, timestamp, boolean, index, uuid, jsonb, integer, numeric } from "drizzle-orm/pg-core";

// IMPORTANT! ID fields should ALWAYS use UUID types, EXCEPT the BetterAuth tables.


export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    phone: text("phone"),
    role: text("role").default("client"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("user_email_idx").on(table.email)]
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("session_user_id_idx").on(table.userId),
    index("session_token_idx").on(table.token),
  ]
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    index("account_provider_account_idx").on(table.providerId, table.accountId),
  ]
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

// Salons table - main business entity
export const salons = pgTable(
  "salons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    industryType: text("industry_type"), // e.g., 'hair_salon', 'beauty', 'medical'
    settingsJson: jsonb("settings_json").default({}),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("salons_owner_id_idx").on(table.ownerId),
  ]
);

// Clients table - customers who book appointments
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    preferences: text("preferences"),
    allergies: text("allergies"),
    favoriteEmployeeId: text("favorite_employee_id"),
    birthday: text("birthday"), // ISO date string "YYYY-MM-DD" for birthday
    requireDeposit: boolean("require_deposit").default(false),
    depositType: text("deposit_type").default("percentage"), // 'percentage' or 'fixed'
    depositValue: numeric("deposit_value", { precision: 10, scale: 2 }), // percentage value or fixed amount in PLN
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("clients_salon_id_idx").on(table.salonId),
    index("clients_email_idx").on(table.email),
    index("clients_phone_idx").on(table.phone),
  ]
);

// Employees table - staff members who provide services
export const employees = pgTable(
  "employees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    photoUrl: text("photo_url"),
    role: text("role").default("employee").notNull(), // 'owner', 'employee', 'receptionist'
    isActive: boolean("is_active").default(true).notNull(),
    color: text("color").default("#3b82f6"), // Color for calendar display
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("employees_salon_id_idx").on(table.salonId),
    index("employees_user_id_idx").on(table.userId),
  ]
);

// Service categories
export const serviceCategories = pgTable(
  "service_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_categories_salon_id_idx").on(table.salonId),
  ]
);

// Services table - services offered by the salon
export const services = pgTable(
  "services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => serviceCategories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    basePrice: numeric("base_price", { precision: 10, scale: 2 }).notNull(),
    baseDuration: integer("base_duration").notNull(), // Duration in minutes
    suggestedNextVisitDays: integer("suggested_next_visit_days"), // Suggested follow-up interval in days (e.g., 30 for monthly haircut)
    depositRequired: boolean("deposit_required").default(false).notNull(),
    depositPercentage: integer("deposit_percentage").default(30), // percentage of service price
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("services_salon_id_idx").on(table.salonId),
    index("services_category_id_idx").on(table.categoryId),
  ]
);

// Appointments table - bookings
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    variantId: uuid("variant_id"), // References service_variants.id
    bookedByUserId: text("booked_by_user_id").references(() => user.id, { onDelete: "set null" }), // User account who booked (for client portal)
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time").notNull(),
    status: text("status").default("scheduled").notNull(), // 'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'
    notes: text("notes"),
    depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 }),
    depositPaid: boolean("deposit_paid").default(false),
    reminderSentAt: timestamp("reminder_sent_at"), // When the 24h SMS reminder was sent
    reminder1hSentAt: timestamp("reminder_1h_sent_at"), // When the 1h SMS reminder was sent
    reminderPushSentAt: timestamp("reminder_push_sent_at"), // When the 24h push notification was sent
    reminderPush1hSentAt: timestamp("reminder_push_1h_sent_at"), // When the 1h push notification was sent
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("appointments_salon_id_idx").on(table.salonId),
    index("appointments_client_id_idx").on(table.clientId),
    index("appointments_employee_id_idx").on(table.employeeId),
    index("appointments_start_time_idx").on(table.startTime),
    index("appointments_status_idx").on(table.status),
  ]
);

// Time blocks - for blocking time (breaks, vacations, etc.)
export const timeBlocks = pgTable(
  "time_blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time").notNull(),
    blockType: text("block_type").notNull(), // 'break', 'vacation', 'personal', 'other'
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("time_blocks_employee_id_idx").on(table.employeeId),
    index("time_blocks_start_time_idx").on(table.startTime),
  ]
);

// Temporary access - for granting temporary permissions to employees
export const temporaryAccess = pgTable(
  "temporary_access",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    featureName: text("feature_name").notNull(),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("temporary_access_user_id_idx").on(table.userId),
    index("temporary_access_expires_at_idx").on(table.expiresAt),
  ]
);

// Service variants - variations of services with price/duration modifiers
export const serviceVariants = pgTable(
  "service_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceModifier: numeric("price_modifier", { precision: 10, scale: 2 }).default("0"),
    durationModifier: integer("duration_modifier").default(0), // in minutes
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_variants_service_id_idx").on(table.serviceId),
  ]
);

// Employee services - junction table for which employees offer which services
export const employeeServices = pgTable(
  "employee_services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("employee_services_employee_id_idx").on(table.employeeId),
    index("employee_services_service_id_idx").on(table.serviceId),
  ]
);

// Employee service prices - custom pricing per employee per service
export const employeeServicePrices = pgTable(
  "employee_service_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => serviceVariants.id, { onDelete: "cascade" }),
    customPrice: numeric("custom_price", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("employee_service_prices_employee_id_idx").on(table.employeeId),
    index("employee_service_prices_service_id_idx").on(table.serviceId),
  ]
);

// Appointment materials - products used during appointment
export const appointmentMaterials = pgTable(
  "appointment_materials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(), // will reference products table
    quantityUsed: numeric("quantity_used", { precision: 10, scale: 2 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("appointment_materials_appointment_id_idx").on(table.appointmentId),
    index("appointment_materials_product_id_idx").on(table.productId),
  ]
);

// Treatment history - detailed records of treatments performed
export const treatmentHistory = pgTable(
  "treatment_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    recipe: text("recipe"),
    techniques: text("techniques"),
    materialsJson: jsonb("materials_json").default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("treatment_history_appointment_id_idx").on(table.appointmentId),
  ]
);

// Work schedules - regular working hours for employees
export const workSchedules = pgTable(
  "work_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(), // 0=Sunday, 1=Monday, etc.
    startTime: text("start_time").notNull(), // e.g., "09:00"
    endTime: text("end_time").notNull(), // e.g., "17:00"
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("work_schedules_employee_id_idx").on(table.employeeId),
    index("work_schedules_day_of_week_idx").on(table.dayOfWeek),
  ]
);

// Gallery photos - before/after photos from treatments
export const galleryPhotos = pgTable(
  "gallery_photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    beforePhotoUrl: text("before_photo_url"),
    afterPhotoUrl: text("after_photo_url"),
    description: text("description"),
    productsUsed: text("products_used"),
    techniques: text("techniques"),
    duration: integer("duration"), // in minutes
    showProductsToClients: boolean("show_products_to_clients").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("gallery_photos_salon_id_idx").on(table.salonId),
    index("gallery_photos_employee_id_idx").on(table.employeeId),
    index("gallery_photos_service_id_idx").on(table.serviceId),
  ]
);

// Albums - photo album organization
export const albums = pgTable(
  "albums",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("albums_salon_id_idx").on(table.salonId),
  ]
);

// Photo albums - junction table for photos and albums
export const photoAlbums = pgTable(
  "photo_albums",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    photoId: uuid("photo_id")
      .notNull()
      .references(() => galleryPhotos.id, { onDelete: "cascade" }),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("photo_albums_photo_id_idx").on(table.photoId),
    index("photo_albums_album_id_idx").on(table.albumId),
  ]
);

// Reviews - client reviews for salons/employees
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    rating: integer("rating"), // 1-5, null for text-only reviews
    comment: text("comment"),
    status: text("status").default("pending").notNull(), // 'pending', 'approved', 'rejected'
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("reviews_salon_id_idx").on(table.salonId),
    index("reviews_client_id_idx").on(table.clientId),
    index("reviews_employee_id_idx").on(table.employeeId),
    index("reviews_status_idx").on(table.status),
  ]
);

// Notifications - SMS/email notifications
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    type: text("type").notNull(), // 'sms', 'email', 'push'
    message: text("message").notNull(),
    sentAt: timestamp("sent_at"),
    status: text("status").default("pending").notNull(), // 'pending', 'sent', 'failed'
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("notifications_salon_id_idx").on(table.salonId),
    index("notifications_client_id_idx").on(table.clientId),
    index("notifications_status_idx").on(table.status),
  ]
);

// Waiting list - clients waiting for available slots
export const waitingList = pgTable(
  "waiting_list",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    preferredEmployeeId: uuid("preferred_employee_id").references(() => employees.id, { onDelete: "set null" }),
    preferredDate: timestamp("preferred_date"),
    notifiedAt: timestamp("notified_at"),
    accepted: boolean("accepted"),
    // Offered slot details (filled when notification is sent)
    offeredStartTime: timestamp("offered_start_time"),
    offeredEndTime: timestamp("offered_end_time"),
    offeredEmployeeId: uuid("offered_employee_id").references(() => employees.id, { onDelete: "set null" }),
    // Link to the client's existing appointment that would be moved
    existingAppointmentId: uuid("existing_appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    // Acceptance token for secure accept/decline links
    acceptToken: text("accept_token"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("waiting_list_salon_id_idx").on(table.salonId),
    index("waiting_list_client_id_idx").on(table.clientId),
    index("waiting_list_service_id_idx").on(table.serviceId),
  ]
);

// Product categories - organize products by type
export const productCategories = pgTable(
  "product_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("product_categories_salon_id_idx").on(table.salonId),
  ]
);

// Products - inventory management
export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).default("0"),
    minQuantity: numeric("min_quantity", { precision: 10, scale: 2 }),
    unit: text("unit"), // e.g., 'ml', 'g', 'pcs'
    pricePerUnit: numeric("price_per_unit", { precision: 10, scale: 2 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("products_salon_id_idx").on(table.salonId),
    index("products_category_idx").on(table.category),
  ]
);

// Product usage - track product usage per appointment
export const productUsage = pgTable(
  "product_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("product_usage_product_id_idx").on(table.productId),
    index("product_usage_appointment_id_idx").on(table.appointmentId),
  ]
);

// Service products - link products to services for automatic stock deduction on completion
export const serviceProducts = pgTable(
  "service_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    defaultQuantity: numeric("default_quantity", { precision: 10, scale: 2 }).notNull().default("1"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_products_service_id_idx").on(table.serviceId),
    index("service_products_product_id_idx").on(table.productId),
  ]
);

// Promotions - discounts and special offers
export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(), // 'percentage', 'fixed', 'package'
    value: numeric("value", { precision: 10, scale: 2 }).notNull(),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    conditionsJson: jsonb("conditions_json").default({}),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("promotions_salon_id_idx").on(table.salonId),
    index("promotions_is_active_idx").on(table.isActive),
  ]
);

// Promo codes - discount codes for clients
export const promoCodes = pgTable(
  "promo_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    promotionId: uuid("promotion_id").references(() => promotions.id, { onDelete: "cascade" }),
    usageLimit: integer("usage_limit"),
    usedCount: integer("used_count").default(0),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("promo_codes_salon_id_idx").on(table.salonId),
    index("promo_codes_code_idx").on(table.code),
    index("promo_codes_promotion_id_idx").on(table.promotionId),
  ]
);

// Loyalty points - client loyalty program
export const loyaltyPoints = pgTable(
  "loyalty_points",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    points: integer("points").default(0).notNull(),
    lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  },
  (table) => [
    index("loyalty_points_client_id_idx").on(table.clientId),
    index("loyalty_points_salon_id_idx").on(table.salonId),
  ]
);

// Loyalty transactions - history of points earned/spent
export const loyaltyTransactions = pgTable(
  "loyalty_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    loyaltyId: uuid("loyalty_id")
      .notNull()
      .references(() => loyaltyPoints.id, { onDelete: "cascade" }),
    pointsChange: integer("points_change").notNull(),
    reason: text("reason"),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("loyalty_transactions_loyalty_id_idx").on(table.loyaltyId),
    index("loyalty_transactions_appointment_id_idx").on(table.appointmentId),
  ]
);

// Invoices - billing documents
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    invoiceNumber: text("invoice_number").notNull(),
    type: text("type").notNull(), // 'paragon', 'faktura'
    companyName: text("company_name"),
    companyNip: text("company_nip"),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("invoices_salon_id_idx").on(table.salonId),
    index("invoices_appointment_id_idx").on(table.appointmentId),
    index("invoices_client_id_idx").on(table.clientId),
    index("invoices_invoice_number_idx").on(table.invoiceNumber),
  ]
);

// Employee commissions - track employee earnings
export const employeeCommissions = pgTable(
  "employee_commissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    percentage: numeric("percentage", { precision: 5, scale: 2 }),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("employee_commissions_employee_id_idx").on(table.employeeId),
    index("employee_commissions_appointment_id_idx").on(table.appointmentId),
  ]
);

// AI conversations - chat history with AI assistant
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    channel: text("channel").notNull(), // 'voice', 'chat', 'sms'
    transcript: text("transcript"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_conversations_salon_id_idx").on(table.salonId),
    index("ai_conversations_client_id_idx").on(table.clientId),
  ]
);

// Newsletters - email campaigns
export const newsletters = pgTable(
  "newsletters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    content: text("content").notNull(),
    sentAt: timestamp("sent_at"),
    recipientsCount: integer("recipients_count").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("newsletters_salon_id_idx").on(table.salonId),
  ]
);

// Marketing consents - GDPR compliance
export const marketingConsents = pgTable(
  "marketing_consents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    consentType: text("consent_type").notNull(), // 'email', 'sms', 'phone'
    grantedAt: timestamp("granted_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [
    index("marketing_consents_client_id_idx").on(table.clientId),
    index("marketing_consents_salon_id_idx").on(table.salonId),
  ]
);

// Favorite salons - client's favorite salons
export const favoriteSalons = pgTable(
  "favorite_salons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientUserId: text("client_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("favorite_salons_client_user_id_idx").on(table.clientUserId),
    index("favorite_salons_salon_id_idx").on(table.salonId),
  ]
);

// Subscription plans - pricing plans (Basic, Pro)
export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(), // 'basic', 'pro'
    priceMonthly: numeric("price_monthly", { precision: 10, scale: 2 }).notNull(),
    stripePriceId: text("stripe_price_id"),
    featuresJson: jsonb("features_json").default([]),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("subscription_plans_slug_idx").on(table.slug),
  ]
);

// Salon subscriptions - active subscriptions for salons
export const salonSubscriptions = pgTable(
  "salon_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCustomerId: text("stripe_customer_id"),
    status: text("status").default("active").notNull(), // 'active', 'past_due', 'canceled', 'trialing'
    trialEndsAt: timestamp("trial_ends_at"),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    canceledAt: timestamp("canceled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("salon_subscriptions_salon_id_idx").on(table.salonId),
    index("salon_subscriptions_plan_id_idx").on(table.planId),
    index("salon_subscriptions_status_idx").on(table.status),
  ]
);

// Subscription payments - payment history
export const subscriptionPayments = pgTable(
  "subscription_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => salonSubscriptions.id, { onDelete: "cascade" }),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").default("PLN").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    status: text("status").notNull(), // 'succeeded', 'pending', 'failed'
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("subscription_payments_subscription_id_idx").on(table.subscriptionId),
    index("subscription_payments_salon_id_idx").on(table.salonId),
    index("subscription_payments_status_idx").on(table.status),
  ]
);

// Deposit payments - track deposit payments for appointments
export const depositPayments = pgTable(
  "deposit_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    salonId: uuid("salon_id")
      .notNull()
      .references(() => salons.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").default("PLN").notNull(),
    paymentMethod: text("payment_method").notNull(), // 'stripe', 'blik'
    blikPhoneNumber: text("blik_phone_number"), // Phone number for Blik P2P payments
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeRefundId: text("stripe_refund_id"), // Stripe refund ID when refund is processed
    status: text("status").default("pending").notNull(), // 'pending', 'succeeded', 'failed', 'refunded'
    paidAt: timestamp("paid_at"),
    refundedAt: timestamp("refunded_at"), // When refund was processed
    refundReason: text("refund_reason"), // Why the refund was issued
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("deposit_payments_appointment_id_idx").on(table.appointmentId),
    index("deposit_payments_salon_id_idx").on(table.salonId),
    index("deposit_payments_status_idx").on(table.status),
  ]
);

// Push notification subscriptions
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(), // Public key for encryption
    auth: text("auth").notNull(), // Auth secret for encryption
    userAgent: text("user_agent"), // Browser user agent for identification
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("push_subscriptions_user_id_idx").on(table.userId),
    index("push_subscriptions_endpoint_idx").on(table.endpoint),
  ]
);
