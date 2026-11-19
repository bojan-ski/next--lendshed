import { t } from "@/lib/text/interpolate";
import { publicEnv } from "@/lib/env/public";
import { HUES, hueStyle } from "@/lib/text/hue";

type StaticDocumentProps = {
  title: string;
  intro: string;
  sections: readonly { heading: string; items: readonly string[] }[];
};

// A green title band, then one white card per section; the dots cycle the hues.
export default function StaticDocument({
  title,
  intro,
  sections,
}: StaticDocumentProps) {
  const fill = (text: string) =>
    t(text, { appName: publicEnv.NEXT_PUBLIC_APP_NAME });

  return (
    <article className="flex max-w-190 flex-col gap-6">
      <div className="surface-accent flex flex-col gap-3.5 rounded-band px-6 py-8 sm:px-11 sm:py-10">
        <h1 className="type-page-title">{title}</h1>
        <p className="type-subhead text-on-accent-highlight">{fill(intro)}</p>
      </div>
      {sections.map((section, index) => (
        <section
          key={section.heading}
          className="flex flex-col gap-3 rounded-card bg-card p-6 sm:px-8 sm:py-7"
        >
          <h2 className="flex items-center gap-3 type-section-title">
            <span
              aria-hidden
              style={hueStyle(HUES[index % HUES.length])}
              className="size-3.5 shrink-0 rounded-full bg-hue-strong"
            />
            {section.heading}
          </h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-6.5 leading-normal">
            {section.items.map((item) => (
              <li key={item}>{fill(item)}</li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
