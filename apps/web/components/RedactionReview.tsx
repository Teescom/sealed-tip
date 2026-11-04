// Accept/edit AI redaction suggestions (S-10.4)
export interface RedactionReviewProps { suggestions: { span: string; reason: string; replacement: string }[] }

export function RedactionReview(_props: RedactionReviewProps) {
  return null; // TODO(S-10.4)
}
