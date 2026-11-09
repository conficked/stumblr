import { expect, test } from "vitest";
import { metadata } from "./layout";

test("share metadata uses the approved tagline and a compact summary card", () => {
  expect(metadata.title).toBe("Stumblr");
  expect(metadata.description).toBe("Explore the internet as your forefathers intended");
  expect(metadata.metadataBase?.toString()).toBe("https://stumblr.dev/");
  expect(metadata.twitter).toMatchObject({ card: "summary", description: metadata.description });
  expect(metadata.openGraph).toMatchObject({ title: "Stumblr", description: metadata.description, images: [{ url: "https://stumblr.dev/brand/stumblr-share-square.png", width: 512, height: 512, type: "image/png", alt: "Stumblr logo" }] });
});
