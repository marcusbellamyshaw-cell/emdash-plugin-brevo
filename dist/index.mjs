function brevoPlugin(options = {}) {
  return {
    id: "emdash-plugin-brevo",
    version: "1.0.0",
    format: "standard",
    entrypoint: "emdash-plugin-brevo/sandbox",
    capabilities: ["hooks.email-transport:register", "network:request"],
    allowedHosts: ["api.brevo.com"],
    adminPages: [{ path: "/brevo", label: "Brevo Email", icon: "mail" }],
    options
  };
}
export {
  brevoPlugin
};
