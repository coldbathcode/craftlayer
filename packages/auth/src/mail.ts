import nodemailer from "nodemailer";
export function createResetDelivery(
  smtpUrl: string,
  from: string,
  publicUrl: string,
) {
  const url = new URL(smtpUrl);
  if (
    url.protocol !== "smtps:" ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  )
    throw new Error("Use a TLS SMTP URL without query options");
  const transport = nodemailer.createTransport({
    host: url.hostname,
    port: Number(url.port || 465),
    secure: true,
    ...(url.username
      ? {
          auth: {
            user: decodeURIComponent(url.username),
            pass: decodeURIComponent(url.password),
          },
        }
      : {}),
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 3000,
    dnsTimeout: 2000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  return async (recipient: string, token: string) => {
    const link = new URL("/account", publicUrl);
    link.hash = `reset=${encodeURIComponent(token)}`;
    await transport.sendMail({
      from,
      to: recipient,
      subject: "Reset your CraftLayer password",
      text: `A password reset was requested for your CraftLayer account.\n\n${link.toString()}\n\nThis link expires in 30 minutes and can be used once. Ignore it if you did not request it.`,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  };
}
