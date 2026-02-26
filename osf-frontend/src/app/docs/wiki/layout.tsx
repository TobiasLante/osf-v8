import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { WikiSidebar } from "@/components/wiki/WikiSidebar";

export default function WikiLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-7xl flex gap-10">
          <WikiSidebar />
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </section>
    </>
  );
}
