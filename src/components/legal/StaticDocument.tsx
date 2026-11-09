import { t } from "@/lib/interpolate";
import { publicEnv } from "@/lib/public-env";

type StaticDocumentProps = {
  title: string;
  intro: string;
  sections: readonly { heading: string; items: readonly string[] }[];
};

export default function StaticDocument({
  title,
  intro,
  sections,
}: StaticDocumentProps) {
  const fill = (text: string) =>
    t(text, { appName: publicEnv.NEXT_PUBLIC_APP_NAME });

  return (
    <article className="flex max-w-prose flex-col gap-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p>{fill(intro)}</p>
      {sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">{section.heading}</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {section.items.map((item) => (
              <li key={item}>{fill(item)}</li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
