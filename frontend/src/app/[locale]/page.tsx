import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { ShopifyIntegration } from "@/components/landing/ShopifyIntegration";
import { Features } from "@/components/landing/Features";
import { Pricing } from "@/components/landing/Pricing";
import { FAQ } from "@/components/landing/FAQ";
import { Footer } from "@/components/landing/Footer";
import { WhatsAppButton } from "@/components/landing/WhatsAppButton";

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        <Hero />
        <div className="bg-surface">
          <HowItWorks />
        </div>
        <ShopifyIntegration />
        <div className="bg-surface">
          <Features />
        </div>
        <Pricing />
        <div className="bg-surface">
          <FAQ />
        </div>
      </main>
      <Footer />
      <WhatsAppButton />
    </>
  );
}