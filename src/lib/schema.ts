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
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time").notNull(),
    status: text("status").default("scheduled").notNull(), // 'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'
    notes: text("notes"),
    depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 }),
    depositPaid: boolean("deposit_paid").default(false),
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
