"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const STARTER_PROMPT = `I'm working with the MyHelper project - an affordable Booksy alternative with AI assistant for service salons. Here's what's already set up:

## Current MyHelper Project Structure
- **Authentication**: Better Auth with Google OAuth integration
- **Database**: Drizzle ORM with PostgreSQL setup  
- **AI Integration**: Vercel AI SDK with OpenRouter (Anthropic Claude Sonnet 4.5)
- **UI**: shadcn/ui components with Tailwind CSS
- **Current Routes**:
  - \`/\` - Home page with setup instructions and feature overview
  - \`/dashboard\` - Protected dashboard page (requires authentication)
  - \`/chat\` - AI chat interface (requires OpenRouter API key)

## Important Context
This is the **MyHelper** project - an affordable Booksy alternative for service salons with AI assistant capabilities. The existing pages and components are the starting point and should be **extended and customized** to build the full application.

### CRITICAL: Build on the MyHelper Foundation
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

## AI Model Configuration
**IMPORTANT**: When implementing any AI functionality, always use the \`OPENROUTER_MODEL\` environment variable for the model name instead of hardcoding it:

\`\`\`typescript
// ✓ Correct - Use environment variable
const model = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4";
model: openrouter(model)

// ✗ Incorrect - Don't hardcode model names
model: openrouter("anthropic/claude-sonnet-4")
\`\`\`

This allows for easy model switching without code changes and ensures consistency across the application.

## Component Development Guidelines
**Always prioritize shadcn/ui components** when building the application:

1. **First Choice**: Use existing shadcn/ui components from the project
2. **Second Choice**: Install additional shadcn/ui components using \`pnpm dlx shadcn@latest add <component-name>\`
3. **Last Resort**: Only create custom components or use other libraries if shadcn/ui doesn't provide a suitable option

The project already includes several shadcn/ui components (button, dialog, avatar, etc.) and follows their design system. Always check the [shadcn/ui documentation](https://ui.shadcn.com/docs/components) for available components before implementing alternatives.

## What I Want to Build
[PROJECT_DESCRIPTION]

## Request
Please help me build out the MyHelper application features. Extend the existing codebase to implement the full functionality described above.

## Success Criteria
**The application should be a fully functional salon management platform** with online booking, client management, service catalog, and AI-powered tools for Pro plan subscribers. It should work as a complete, polished Booksy alternative.

## Post-Implementation Documentation
After completing the implementation, you MUST document any new features or significant changes in the \`/docs/features/\` directory:

1. **Create Feature Documentation**: For each major feature implemented, create a markdown file in \`/docs/features/\` that explains:
   - What the feature does
   - How it works
   - Key components and files involved
   - Usage examples
   - Any configuration or setup required

2. **Update Existing Documentation**: If you modify existing functionality, update the relevant documentation files to reflect the changes.

3. **Document Design Decisions**: Include any important architectural or design decisions made during implementation.

This documentation helps maintain the project and assists future developers working with the codebase.

Think hard about the solution and implementing the user's requirements.`;

export function StarterPromptModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [projectDescription, setProjectDescription] = useState("");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const finalPrompt = projectDescription.trim()
      ? STARTER_PROMPT.replace(
          "[PROJECT_DESCRIPTION]",
          projectDescription.trim()
        )
      : STARTER_PROMPT.replace("\n[PROJECT_DESCRIPTION]\n", "");

    try {
      await navigator.clipboard.writeText(finalPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="w-full">
          <Copy className="w-4 h-4 mr-2" />
          Get AI Starter Prompt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate AI Starter Prompt</DialogTitle>
          <DialogDescription>
            Create a comprehensive prompt to help AI agents create your project
            for you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="project-description"
              className="text-sm font-medium mb-2 block"
            >
              Describe your project (optional)
            </label>
            <textarea
              id="project-description"
              placeholder="e.g., A task management app for teams with real-time collaboration, project timelines, and AI-powered task prioritization..."
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              className="w-full h-24 px-3 py-2 border rounded-md resize-none text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Optional: Add details about your project to get a more tailored
              prompt
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleCopy} className="flex-1">
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Starter Prompt
                </>
              )}
            </Button>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
          </div>

          <div className="text-xs text-muted-foreground border-t pt-3">
            <strong>How to use:</strong> Copy this prompt and paste it into
            Claude Code, Cursor, or any AI coding assistant to get started with
            your project.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
