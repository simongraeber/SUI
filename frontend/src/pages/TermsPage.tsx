import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
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

        <h2>5. Liability</h2>
        <p>
          {company} is not liable for indirect or consequential damages arising
          from your use of the service.
        </p>

        <h2>6. Changes</h2>
        <p>
          We may update these terms at any time. Continued use constitutes
          acceptance. Contact us at 80-read-crewel@icloud.com with questions.
        </p>
      </main>

      <div className="mt-6">
        <Button variant="outline" asChild>
          <Link to="/">Go back to Home Page</Link>
        </Button>
      </div>
    </PageTransition>
  );
}

export default TermsPage;
