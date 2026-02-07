I'm working with the MyHelper project - an affordable Booksy alternative with AI assistant for service salons. Here's what's already set up:

## Current MyHelper Project Structure

- **Authentication**: Better Auth with Google OAuth integration
- **Database**: Drizzle ORM with PostgreSQL setup
- **AI Integration**: Vercel AI SDK with OpenRouter (Anthropic Claude Sonnet 4.5)
- **UI**: shadcn/ui components with Tailwind CSS
- **Current Routes**:
  - `/` - Home page with setup instructions and feature overview
  - `/dashboard` - Protected dashboard page (requires authentication)
  - `/chat` - AI chat interface (requires OpenRouter API key)

## Important Context

This is the **MyHelper** project - an affordable Booksy alternative for service salons with AI assistant capabilities. The existing pages and components are the starting point and should be **extended and customized** to build the full application.

### Build on the MyHelper Foundation

**Extend the existing MyHelper structure** to implement the full feature set:

- **Replace placeholder/demo content** with actual MyHelper functionality
- **Customize the navigation** for salon management workflows
- **Build out the pages** for bookings, services, clients, and salon management
- **Add subscription features** (Basic and Pro plans via Stripe)
- **Implement AI tools** (voice assistant, business analytics, content generator) for Pro plan

### Required Actions:

1. **Build on existing stack**: Use the existing tech stack and extend it
2. **Implement MyHelper features**: Bookings, services, clients, salon management, subscriptions
3. **AI features for Pro plan**: Voice assistant, business analytics, content generation
4. **Maintain consistency**: Follow existing patterns and coding conventions

The only things to preserve are:

- **All installed libraries and dependencies** (DO NOT uninstall or remove any packages from package.json)
- **Authentication system** (but customize the UI/flow as needed)
- **Database setup and schema** (but modify schema as needed for your use case)
- **Core configuration files** (next.config.ts, tsconfig.json, tailwind.config.ts, etc.)
- **Build and development scripts** (keep all npm/pnpm scripts in package.json)

## Tech Stack

- Next.js 16 with App Router
- TypeScript
- Tailwind CSS
- Better Auth for authentication
- Drizzle ORM + PostgreSQL
- Vercel AI SDK
- shadcn/ui components
- Lucide React icons

## Component Development Guidelines

**Always prioritize shadcn/ui components** when building the application:

1. **First Choice**: Use existing shadcn/ui components from the project
2. **Second Choice**: Install additional shadcn/ui components using `pnpm dlx shadcn@latest add <component-name>`
3. **Last Resort**: Only create custom components or use other libraries if shadcn/ui doesn't provide a suitable option

The project already includes several shadcn/ui components (button, dialog, avatar, etc.) and follows their design system. Always check the [shadcn/ui documentation](https://ui.shadcn.com/docs/components) for available components before implementing alternatives.

## What MyHelper Does

MyHelper is an affordable Booksy alternative for service salons with:
- Online booking system for clients
- Service and staff management
- Client database with visit history
- AI-powered assistant (Pro plan) - voice, business analytics, content generation
- Subscription billing via Stripe (Basic and Pro plans)

## Request

Please help me build out the MyHelper application features. Extend the existing codebase to implement the full functionality described above.

## Success Criteria

**The application should be a fully functional salon management platform** with online booking, client management, service catalog, and AI-powered tools for Pro plan subscribers.

## Post-Implementation Documentation

After completing the implementation, you MUST document any new features or significant changes in the `/docs/features/` directory:

1. **Create Feature Documentation**: For each major feature implemented, create a markdown file in `/docs/features/` that explains:

   - What the feature does
   - How it works
   - Key components and files involved
   - Usage examples
   - Any configuration or setup required

2. **Update Existing Documentation**: If you modify existing functionality, update the relevant documentation files to reflect the changes.

3. **Document Design Decisions**: Include any important architectural or design decisions made during implementation.

This documentation helps maintain the project and assists future developers working with the codebase.
