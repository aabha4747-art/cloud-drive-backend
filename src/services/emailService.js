const nodemailer =
  require("nodemailer");

// ======================================================
// TRANSPORTER
// ======================================================

const transporter =
  nodemailer.createTransport({
    service:
      "gmail",

    auth: {
      user:
        process.env
          .EMAIL_USER,

      pass:
        process.env
          .EMAIL_APP_PASSWORD,
    },
  });

// ======================================================
// VERIFY EMAIL CONFIG
// ======================================================

const verifyEmailTransport =
  async () => {
    try {
      await transporter.verify();

      console.log(
        "Email service connected successfully"
      );

      return true;
    } catch (error) {
      console.error(
        "Email service verification failed:",
        error.message
      );

      return false;
    }
  };

// ======================================================
// SEND SHARE EMAIL
// ======================================================

const sendShareEmail =
  async ({
    to,
    recipientName,
    sharerName,
    itemName,
    resourceType,
    permission,
    openUrl,
  }) => {
    const safeRecipientName =
      recipientName ||
      "there";

    const safeSharerName =
      sharerName ||
      "Someone";

    const typeLabel =
      resourceType ===
      "folder"
        ? "folder"
        : "file";

    const permissionLabel =
      permission ===
      "editor"
        ? "Editor"
        : "Viewer";

    const subject =
      `${safeSharerName} shared "${itemName}" with you`;

    const text =
      `
Hi ${safeRecipientName},

${safeSharerName} shared the ${typeLabel} "${itemName}" with you.

Access: ${permissionLabel}

Open in Cloud Drive:
${openUrl}

Cloud Drive
      `.trim();

    const html =
      `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />
</head>

<body
  style="
    margin: 0;
    padding: 0;
    background: #f6f8fc;
    font-family: Arial, Helvetica, sans-serif;
    color: #1e293b;
  "
>

  <table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    style="
      background: #f6f8fc;
      padding: 32px 16px;
    "
  >
    <tr>
      <td align="center">

        <table
          width="100%"
          cellpadding="0"
          cellspacing="0"
          style="
            max-width: 560px;
            background: #ffffff;
            border-radius: 18px;
            overflow: hidden;
            box-shadow:
              0 12px 30px rgba(15,23,42,0.08);
          "
        >

          <tr>
            <td
              style="
                padding: 28px 32px 20px;
              "
            >

              <div
                style="
                  font-size: 22px;
                  font-weight: 700;
                  margin-bottom: 8px;
                "
              >
                Cloud Drive
              </div>

              <div
                style="
                  color: #64748b;
                  font-size: 14px;
                "
              >
                File sharing notification
              </div>

            </td>
          </tr>

          <tr>
            <td
              style="
                padding: 0 32px 28px;
              "
            >

              <p
                style="
                  font-size: 16px;
                  margin-bottom: 16px;
                "
              >
                Hi ${safeRecipientName},
              </p>

              <p
                style="
                  font-size: 16px;
                  line-height: 1.6;
                  margin-bottom: 22px;
                "
              >
                <strong>
                  ${safeSharerName}
                </strong>
                shared a ${typeLabel} with you.
              </p>

              <div
                style="
                  border: 1px solid #e2e8f0;
                  background: #f8fafc;
                  border-radius: 14px;
                  padding: 18px;
                  margin-bottom: 24px;
                "
              >

                <div
                  style="
                    font-size: 16px;
                    font-weight: 700;
                    margin-bottom: 8px;
                  "
                >
                  ${itemName}
                </div>

                <div
                  style="
                    font-size: 13px;
                    color: #64748b;
                  "
                >
                  ${typeLabel}
                  &nbsp;•&nbsp;
                  ${permissionLabel} access
                </div>

              </div>

              <a
                href="${openUrl}"
                style="
                  display: inline-block;
                  background:
                    linear-gradient(
                      135deg,
                      #6366f1,
                      #7c3aed
                    );
                  color: #ffffff;
                  text-decoration: none;
                  padding: 12px 20px;
                  border-radius: 10px;
                  font-weight: 700;
                  font-size: 14px;
                "
              >
                Open in Cloud Drive
              </a>

            </td>
          </tr>

          <tr>
            <td
              style="
                border-top: 1px solid #f1f5f9;
                padding: 20px 32px;
                color: #94a3b8;
                font-size: 12px;
                line-height: 1.6;
              "
            >
              You received this email because a Cloud Drive user shared an item with your account.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
      `;

    const info =
      await transporter.sendMail({
        from:
          `"Cloud Drive" <${process.env.EMAIL_USER}>`,

        to,

        subject,

        text,

        html,
      });

    return info;
  };

module.exports = {
  verifyEmailTransport,
  sendShareEmail,
};