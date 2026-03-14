import { ArrowLeft } from "lucide-react";
import LinkButton from "@/components/LinkButton";
import PageTransition from "@/components/PageTransition";

function TermsPage() {
  const company = "SIU";
  const jurisdiction = "Finland";

  return (
    <PageTransition className="max-w-3xl mx-auto px-4 py-8 text-center">
      <h1 className="text-3xl font-bold mb-4">Terms of Service</h1>

      <main className="legal-content">
        <h2>1. Acceptance</h2>
        <p>
          By using {company} you agree to these terms. If you disagree, please
          stop using the service.
        </p>

        <h2>2. Service</h2>
        <p>
          {company} provides a web-based platform hosted in {jurisdiction}. We
          may modify or discontinue the service at any time.
        </p>

        <h2>3. User Conduct</h2>
        <p>
          Do not use the service for unlawful purposes, upload harmful content,
          or attempt to gain unauthorized access to our systems.
        </p>

        <h2>4. User Content</h2>
        <p>
          By uploading content you grant us a licence to use it to provide the
          service. Do not upload images containing personal or sensitive data.
        </p>

        <h2>5. Group Data Visibility</h2>
        <p>
          When you join a group, your display name, e-mail address, and profile
          picture will be visible to all other members of that group. By joining
          a group you agree to this sharing of information.
        </p>

        <h2>6. Liability</h2>
        <p>
          {company} is not liable for indirect or consequential damages arising
          from your use of the service.
        </p>

        <h2>7. Changes</h2>
        <p>
          We may update these terms at any time. Continued use constitutes
          acceptance. Contact us at 80-read-crewel@icloud.com with questions.
        </p>
      </main>

      <div className="mt-6">
        <LinkButton variant="outline" to="/">
          <ArrowLeft className="size-4" />
          Back to Home
        </LinkButton>
      </div>
    </PageTransition>
  );
}

export default TermsPage;
