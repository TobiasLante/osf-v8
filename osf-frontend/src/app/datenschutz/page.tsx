import { BackgroundOrbs } from "@/components/BackgroundOrbs";

export default function DatenschutzPage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold mb-8">Datenschutzerkl&auml;rung</h1>

          <div className="space-y-6 text-text-muted text-sm leading-relaxed">
            <div>
              <h2 className="text-lg font-semibold text-text mb-2">1. Verantwortlicher</h2>
              <p>
                Tobias Lante<br />
                Raiffeisenstr. 3b<br />
                82433 Bad Kohlgrub<br />
                E-Mail: tobias@zeroguess.ai
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text mb-2">2. Erhebung und Verarbeitung personenbezogener Daten</h2>
              <p>
                Bei der Nutzung von OpenShopFloor werden folgende Daten verarbeitet:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>E-Mail-Adresse und Name bei der Registrierung</li>
                <li>Chat-Verl&auml;ufe und Flow-Ausf&uuml;hrungsdaten (zur Bereitstellung des Dienstes)</li>
                <li>Server-Logdaten (IP-Adresse, Zeitstempel, Zugriffspfade)</li>
              </ul>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text mb-2">3. Zweck der Datenverarbeitung</h2>
              <p>
                Die Daten werden ausschlie&szlig;lich zur Bereitstellung und Verbesserung des Dienstes verwendet.
                Es erfolgt keine Weitergabe an Dritte zu Werbezwecken.
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text mb-2">4. Cookies</h2>
              <p>
                OpenShopFloor verwendet ausschlie&szlig;lich technisch notwendige Cookies (Authentifizierung, Spracheinstellungen).
                Es werden keine Tracking-Cookies eingesetzt.
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text mb-2">5. Webanalyse</h2>
              <p>
                Wir verwenden eine selbst gehostete, cookie-freie Analysesoftware. Die Auswertung erfolgt
                anonymisiert und l&auml;sst keine R&uuml;ckschl&uuml;sse auf einzelne Personen zu.
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text mb-2">6. Hosting und KI-Verarbeitung</h2>
              <p>
                Die Anwendung wird auf eigener Infrastruktur in Deutschland gehostet.
                Die KI-Modelle laufen lokal auf eigenen Servern &mdash; es werden keine Daten an
                externe KI-Anbieter (OpenAI, Google, etc.) &uuml;bermittelt.
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text mb-2">7. Ihre Rechte</h2>
              <p>
                Sie haben das Recht auf Auskunft, Berichtigung, L&ouml;schung und Einschr&auml;nkung der Verarbeitung
                Ihrer personenbezogenen Daten. Kontaktieren Sie uns unter tobias@zeroguess.ai.
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text mb-2">8. L&ouml;schung</h2>
              <p>
                Ihr Konto und alle damit verbundenen Daten k&ouml;nnen jederzeit auf Anfrage gel&ouml;scht werden.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
