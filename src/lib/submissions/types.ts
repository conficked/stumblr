import { Topic } from "@/lib/catalogue/types";

export type SuggestionStatus = "pending_review";

export type CommunitySuggestion = {
  id: string;
  canonicalUrl: string;
  domain: string;
  submittedAt: string;
  status: SuggestionStatus;
  source: "community";
  title: string | null;
  note: string | null;
  topics: Topic[];
  submitterHash: string;
};

export type SuggestionStore = {
  version: 1;
  suggestions: CommunitySuggestion[];
};

export type SuggestionInput = {
  url: string;
  title?: string;
  note?: string;
  topics?: Topic[];
};
