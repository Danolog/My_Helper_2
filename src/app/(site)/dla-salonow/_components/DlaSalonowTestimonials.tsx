"use client";

import { motion } from "framer-motion";
import {
  Star,
  MessageCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";

const TESTIMONIALS = [
  {
    name: "Tester Beta",
    role: "Wlascicielka salonu fryzjerskiego",
    quote: "MyHelper to swietne narzedzie do zarzadzania salonem. Rezerwacje online i kalendarz pracownikow dzialaja bezblednie.",
    rating: 5,
  },
  {
    name: "Tester Beta",
    role: "Kosmetyczka",
    quote: "Asystent AI pomaga planowac promocje i tworzyc posty na social media. Duza oszczednosc czasu.",
    rating: 5,
  },
  {
    name: "Tester Beta",
    role: "Wlascicielka SPA",
    quote: "Konkurencyjna cena w porownaniu z innymi rozwiazaniami na rynku, a funkcjonalnosc na wysokim poziomie.",
    rating: 5,
  },
] as const;

export function DlaSalonowTestimonials() {
  return (
    <section className="container mx-auto px-4 py-24 md:py-32" aria-labelledby="testimonials-heading">
      <div className="text-center mb-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
        >
          <Badge variant="outline" className="text-sm px-5 py-2 mb-6 border-primary/20 text-primary">
            <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
            Opinie
          </Badge>
          <h2 id="testimonials-heading" className="font-[family-name:var(--font-playfair)] text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Co mówią nasi klienci
          </h2>
          <p className="text-muted-foreground/90 max-w-2xl mx-auto text-xl font-light">
            Dołącz do grona zadowolonych właścicieli salonów premium.
          </p>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {TESTIMONIALS.map((testimonial, index) => (
          <motion.div
            key={testimonial.name}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, delay: index * 0.15 }}
          >
            <Card className="border-border/40 bg-card/60 backdrop-blur-sm hover:-translate-y-2 hover:shadow-[0_15px_40px_rgba(0,0,0,0.08)] transition-all duration-500 h-full">
              <CardContent className="pt-10 px-8 pb-8 flex flex-col h-full">
                <div className="flex gap-1 mb-6">
                  {Array.from({ length: testimonial.rating }).map((_, i) => (
                    <Star key={i} className="h-5 w-5 fill-gold-light text-gold-light" />
                  ))}
                </div>
                <p className="text-lg text-foreground/80 leading-relaxed mb-8 italic font-light flex-1">
                  &ldquo;{testimonial.quote}&rdquo;
                </p>
                <div className="pt-6 border-t border-border/40">
                  <div className="font-semibold text-base mb-1">{testimonial.name}</div>
                  <div className="text-sm text-primary/80">{testimonial.role}</div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
