export const metadata = {
  title: "Empowerment",
  description: "Sign in to explore my journey",
};

import Providers from "./providers";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#ffffff",
          color: "#000000",
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
