import { ArrowLeft } from "lucide-react";
import LinkButton from "@/components/LinkButton";
import PageTransition from "@/components/PageTransition";

function PrivacyPage() {
  const company = "SIU";
  const jurisdiction = "Finland";

  return (
    <PageTransition className="max-w-3xl mx-auto px-4 py-8 text-center">
      <h1 className="text-3xl font-bold mb-4">Privacy</h1>

      <main className="legal-content">
        <h2>1. General Information</h2>
        <p>
          This Privacy Policy explains how {company} ('we' or 'us') processes,
          stores, and protects your personal data in accordance with the EU
          General Data Protection Regulation (GDPR). This website is hosted in{" "}
          {jurisdiction}.
        </p>

        <h2>2. Data Controller</h2>
        <p>
          Data Controller: {company}
          <br />
          Address: Mitthenheimer Str. 6, 85764 Oberschleißheim, Germany
          <br />
          E-Mail: 80-read-crewel@icloud.com
        </p>

        <h2>3. Data Collection</h2>
        <p>
          We collect the data you provide when you register or use our services.
          For login purposes, we use an OAuth2 client that provides your unique
          user identifier ('sub') along with your name, e-mail address, and
          profile picture. This information is used to identify you within the
          service and is <strong>visible to all members of any group you
          join</strong> (e.g. on leaderboards, game history, and player
          profiles). By joining a group you consent to sharing your name,
          e-mail address, and profile picture with the other members of that
          group.
        </p>

        <h2>4. Profile Images</h2>
        <p>
          Your profile image is stored on our servers and may be passed on to
          third-party services for processing (e.g. image optimization or
          content moderation). Please <strong>do not upload any images
          containing personal or sensitive data</strong> (such as identity
          documents, medical records, or other private information). By
          uploading a profile image you acknowledge that it may be processed by
          external services.
        </p>

        <h2>5. Purposes of Processing</h2>
        <p>We process your data for the following purposes:</p>
        <ul>
          <li>Providing and improving our services</li>
          <li>
            Functionally mapping data to your user identifier
          </li>
          <li>Compliance with legal obligations</li>
        </ul>

        <h2>6. Your Rights</h2>
        <p>
          You have the right to access, rectify, or delete your personal data, to
          restrict processing, to data portability, and to object to the
          processing of your data. Please contact us at
          80-read-crewel@icloud.com to exercise these rights.
        </p>

        <h2>7. Data Security</h2>
        <p>
          We implement technical and organizational measures to protect your data,
          including SSL encryption. Our server is located in Finland.
        </p>

        <h2>8. Changes to this Policy</h2>
        <p>
          We reserve the right to update this Privacy Policy from time to time.
          The most current version will always be published on our website.
        </p>

        <h2>9. Contact</h2>
        <p>
          If you have any questions regarding this Privacy Policy, please contact
          us at 80-read-crewel@icloud.com.
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

export default PrivacyPage;
