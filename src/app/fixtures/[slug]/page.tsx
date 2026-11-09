import { CanvasFixture } from "./CanvasFixture";

type FixturePageProps = {
  params: Promise<{ slug: string }>;
};

const fixtureCopy: Record<string, { title: string; body: string }> = {
  ok: {
    title: "Fixture: embeddable success",
    body: "This fixture represents a healthy destination frame load and interaction.",
  },
  blocked: {
    title: "Fixture: likely blocked destination",
    body: "Embedding Not Allowed. This fixture simulates publisher denial copy visible inside the frame.",
  },
  timeout: {
    title: "Fixture: timeout simulation",
    body: "Use this fixture with artificial timeout handling in integration tests.",
  },
  error: {
    title: "Fixture: error simulation",
    body: "Use this fixture with artificial frame error handling in integration tests.",
  },
};

export function generateStaticParams() {
  return [{ slug: "ok" }, { slug: "blocked" }, { slug: "timeout" }, { slug: "error" }, { slug: "canvas" }];
}

export default async function FixturePage({ params }: FixturePageProps) {
  const { slug } = await params;
  if (slug === "canvas") {
    return <CanvasFixture />;
  }
  const content = fixtureCopy[slug] ?? {
    title: `Fixture: ${slug}`,
    body: "Generic fixture endpoint.",
  };

  return (
    <main className="min-h-screen bg-white p-10 text-black">
      <h1 className="text-2xl font-semibold">{content.title}</h1>
      <p className="mt-3 text-base">{content.body}</p>
      <p className="mt-3 text-sm text-zinc-700">
        Fixture content loaded.
      </p>
    </main>
  );
}
