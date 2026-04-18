import { useTranslations } from "next-intl";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";

export default function PrivacyPage() {
  const t = useTranslations("Privacy");

  return (
    <>
      <Navbar />
      <main className="flex-1 pt-28 pb-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-foreground sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("lastUpdated")}</p>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground">
            {t("intro")}
          </p>

          {(["1", "2", "3", "4", "5", "6"] as const).map((n) => (
            <section key={n} className="mt-8">
              <h2 className="text-xl font-semibold text-foreground">
                {t(`section${n}Title`)}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                {t(`section${n}Content`)}
              </p>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
