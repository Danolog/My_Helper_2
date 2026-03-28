## AI Features (Pro Plan)

All AI features require Pro plan (149 PLN/mies). Gated by `requireProAI()` server-side and `ProPlanGate` component client-side.

### Shared Utilities (`src/lib/ai/`)
- `openrouter.ts` — createAIClient(), getAIModel(), requireProAI(), isProAIError(), getSalonContext(), gatherSalonData(), trackAIUsage()
- `elevenlabs.ts` — createElevenLabsClient(), DEFAULT_VOICE_ID, DEFAULT_TTS_MODEL
- `google-imagen.ts` — createGoogleAIClient(), generateImage(), IMAGE_STYLE_PRESETS, IMAGE_SIZES
- `google-veo.ts` — startVideoGeneration(), checkVideoStatus(), VEO_MODEL
- `twilio.ts` — createTwilioClient(), getTwilioPhoneNumber(), isTwilioConfigured()

### AI API Endpoints
| Endpoint | Purpose |
|----------|---------|
| POST /api/ai/appointments/auto-summary | AI summary after appointment completion |
| POST /api/ai/categorize | Auto-categorize services/products |
| POST /api/ai/clients/insights | Client analysis (churn risk, trends) |
| POST /api/ai/search | Natural language search (Cmd+K) |
| POST /api/ai/notifications/personalize | Personalize notification messages |
| POST /api/ai/voice/tts | ElevenLabs Text-to-Speech |
| POST /api/ai/voice/stt | ElevenLabs Speech-to-Text |
| POST /api/ai/voice/interpret-command | Voice command interpretation |
| POST /api/ai/image/generate | Google Imagen image generation |
| POST /api/ai/image/enhance | Sharp photo enhancement (7 presets) |
| POST /api/ai/image/banner | Promotional banner (AI bg + text overlay) |
| POST /api/ai/image/service-illustration | Service placeholder illustration |
| POST /api/ai/video/generate | Google Veo async video generation |
| GET /api/ai/video/status/[taskId] | Video generation polling |
| POST /api/ai/video/story | Animated Instagram Stories (9:16) |
| POST /api/ai/video/testimonial-template | Video testimonial text scripts |
| GET /api/ai/usage | AI cost monitoring stats |
| POST /api/ai/voice/twilio/webhook | Twilio incoming call handler |
| POST /api/ai/voice/twilio/status | Twilio call status callback |

### AI Components
- `VoiceTextarea` — Textarea with ElevenLabs mic button
- `ReadAloudButton` — TTS playback button
- `VoiceCommandButton` — Floating mic for voice commands
- `ClientInsightsTab` — AI analysis tab on client profile
- `ImageGenerator` — Social media graphics generator
- `VideoGenerator` — Promotional video clips (Veo)
- `StoryGenerator` — Animated Instagram Stories
- `TestimonialTemplate` — Video testimonial scripts
- `BannerGenerator` — Promotional banners
- `PhotoEnhanceDialog` — Gallery photo enhancement
- `ServiceIllustrationButton` — Service image generation

### AI Hooks
- `useVoiceInput` — MediaRecorder + ElevenLabs STT
- `useTextToSpeech` — ElevenLabs TTS playback
- `useAISearch` — Debounced natural language search (>3 words)

## Environment Variables (AI)

```
OPENROUTER_API_KEY                    # AI via OpenRouter (tylko Pro)
OPENROUTER_MODEL                      # domyslnie anthropic/claude-sonnet-4-5-20250929
ELEVENLABS_API_KEY                    # ElevenLabs voice AI (TTS, STT)
GOOGLE_AI_API_KEY                     # Google Imagen + Veo (images, video)
TWILIO_ACCOUNT_SID                    # Twilio telephony (optional)
TWILIO_AUTH_TOKEN                     # Twilio telephony (optional)
TWILIO_PHONE_NUMBER                   # Twilio phone number (optional)
```
