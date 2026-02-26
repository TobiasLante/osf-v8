import { BackgroundOrbs } from "@/components/BackgroundOrbs";

export default function ImpressumPage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold mb-8">Impressum</h1>

          <div className="space-y-6 text-text-muted text-sm leading-relaxed">
            <div>
              <h2 className="text-lg font-semibold text-text mb-2">Angaben gem. &sect; 5 TMG</h2>
              <p>
                Tobias Lante<br />
                Raiffeisenstr. 3b<br />
                82433 Bad Kohlgrub<br />
                Deutschland
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text mb-2">Kontakt</h2>
              <p>E-Mail: tobias@zeroguess.ai</p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text mb-2">Verantwortlich f&uuml;r den Inhalt gem. &sect; 55 Abs. 2 RSt V</h2>
              <p>
                Tobias Lante<br />
                Raiffeisenstr. 3b<br />
                82433 Bad Kohlgrub
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text mb-2">Haftungsausschluss</h2>
              <p>
                Die Inhalte dieser Seiten wurden mit gr&ouml;&szlig;ter Sorgfalt erstellt. F&uuml;r die Richtigkeit,
                Vollst&auml;ndigkeit und Aktualit&auml;t der Inhalte kann jedoch keine Gew&auml;hr &uuml;bernommen werden.
                Als Diensteanbieter sind wir gem&auml;&szlig; &sect; 7 Abs. 1 TMG f&uuml;r eigene Inhalte auf diesen Seiten
                nach den allgemeinen Gesetzen verantwortlich. Nach &sect;&sect; 8 bis 10 TMG sind wir als Diensteanbieter
                jedoch nicht verpflichtet, &uuml;bermittelte oder gespeicherte fremde Informationen zu &uuml;berwachen
                oder nach Umst&auml;nden zu forschen, die auf eine rechtswidrige T&auml;tigkeit hinweisen.
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text mb-2">Urheberrecht</h2>
              <p>
                Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem
                deutschen Urheberrecht. Die Vervielf&auml;ltigung, Bearbeitung, Verbreitung und jede Art der
                Verwertung au&szlig;erhalb der Grenzen des Urheberrechtes bed&uuml;rfen der schriftlichen Zustimmung
                des jeweiligen Autors bzw. Erstellers.
              </p>
              <p className="mt-2">
                Der Quellcode von OpenShopFloor ist unter der AGPL-3.0 Lizenz ver&ouml;ffentlicht.
                Details siehe{" "}
                <a
                  href="https://github.com/TobiasLante/openshopfloor"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  GitHub
                </a>.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
