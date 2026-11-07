import type { AdminPageProps } from "@sport-cms/module-sdk";

/**
 * Screen of the back-office added by the module (`adminPages`): what a module author starts
 * from. Plain markup: the styles of the back-office are not part of the contract.
 */
export function AboutPage({ module }: AdminPageProps) {
  return (
    <section>
      <h1>À propos du module {module.name}</h1>
      <p>
        Version {module.version}. Ce module de démonstration ajoute le bloc « Citation » à l'éditeur
        de pages : ouvrez une page, puis cliquez sur « Citation » dans la liste des blocs.
      </p>
    </section>
  );
}
