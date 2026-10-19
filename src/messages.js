// -----------------------------------------------------------------------------
// Every sentence the integration shows a user, in the four languages of the
// Gladys interface (src/i18n.js). Gladys picks the reader's language and falls
// back to English.
// -----------------------------------------------------------------------------

import { localize, pick } from './i18n.js';

const t = (texts) => localize((language) => pick(language, texts));

export const MESSAGES = {
  notLinked: t({
    en: 'No myAudi account linked yet: click "Connect" in the configuration.',
    fr: 'Aucun compte myAudi relié : cliquez sur « Connecter » dans la configuration.',
    de: 'Noch kein myAudi-Konto verbunden: Klicke in der Konfiguration auf „Verbinden“.',
    es: 'Aún no hay ninguna cuenta myAudi vinculada: pulse «Conectar» en la configuración.',
  }),
  relink: t({
    en: 'Audi refused the stored sign-in: click "Connect" again in the configuration.',
    fr: 'Audi a refusé la connexion enregistrée : cliquez de nouveau sur « Connecter » dans la configuration.',
    de: 'Audi hat die gespeicherte Anmeldung abgelehnt: Klicke in der Konfiguration erneut auf „Verbinden“.',
    es: 'Audi ha rechazado el inicio de sesión guardado: pulse de nuevo «Conectar» en la configuración.',
  }),
  initFailed: t({
    en: 'The Audi cloud could not be reached, check the integration logs. Retrying at the next refresh.',
    fr: "Le cloud Audi est injoignable, consultez les journaux de l'intégration. Nouvel essai au prochain rafraîchissement.",
    de: 'Die Audi-Cloud ist nicht erreichbar, prüfe die Protokolle der Integration. Neuer Versuch bei der nächsten Aktualisierung.',
    es: 'No se puede acceder a la nube de Audi, consulte los registros de la integración. Se volverá a intentar en la próxima actualización.',
  }),
  noCars: t({
    en: 'Connected, but this myAudi account has no car.',
    fr: "Connecté, mais ce compte myAudi n'a aucune voiture.",
    de: 'Verbunden, aber dieses myAudi-Konto hat kein Fahrzeug.',
    es: 'Conectado, pero esta cuenta myAudi no tiene ningún coche.',
  }),
};

/** Waiting for the user to approve the sign-in on the Audi page. */
export const waitingForApproval = (code) =>
  t({
    en: `Waiting for your approval on the Audi page (code ${code}).`,
    fr: `En attente de votre validation sur la page Audi (code ${code}).`,
    de: `Warte auf deine Bestätigung auf der Audi-Seite (Code ${code}).`,
    es: `Esperando su aprobación en la página de Audi (código ${code}).`,
  });

export const LINK_FAILED = {
  expired: t({
    en: 'The sign-in code expired before it was approved: click "Connect" again.',
    fr: "Le code de connexion a expiré avant d'être validé : cliquez de nouveau sur « Connecter ».",
    de: 'Der Anmeldecode ist abgelaufen, bevor er bestätigt wurde: Klicke erneut auf „Verbinden“.',
    es: 'El código de inicio de sesión caducó antes de ser aprobado: pulse de nuevo «Conectar».',
  }),
  denied: t({
    en: 'The sign-in was refused on the Audi page.',
    fr: 'La connexion a été refusée sur la page Audi.',
    de: 'Die Anmeldung wurde auf der Audi-Seite abgelehnt.',
    es: 'El inicio de sesión fue rechazado en la página de Audi.',
  }),
  error: t({
    en: 'The sign-in failed, check the integration logs and click "Connect" again.',
    fr: "La connexion a échoué, consultez les journaux de l'intégration et cliquez de nouveau sur « Connecter ».",
    de: 'Die Anmeldung ist fehlgeschlagen, prüfe die Protokolle und klicke erneut auf „Verbinden“.',
    es: 'El inicio de sesión ha fallado, consulte los registros y pulse de nuevo «Conectar».',
  }),
};

/** Answer of the "Test the connection" action. */
export function connectionReport({ linked, cars, remaining, error }) {
  if (!linked) {
    return MESSAGES.notLinked;
  }
  if (error) {
    return t({
      en: `Linked, but the Audi cloud answered with an error: ${error}`,
      fr: `Compte relié, mais le cloud Audi a répondu par une erreur : ${error}`,
      de: `Verbunden, aber die Audi-Cloud hat mit einem Fehler geantwortet: ${error}`,
      es: `Vinculada, pero la nube de Audi respondió con un error: ${error}`,
    });
  }
  if (cars.length === 0) {
    return MESSAGES.noCars;
  }
  const names = cars.join(', ');
  const calls = remaining === null || remaining === undefined ? null : remaining;
  return localize((language) => {
    const head = pick(language, {
      en: `Connected. Cars: ${names}.`,
      fr: `Connecté. Voitures : ${names}.`,
      de: `Verbunden. Fahrzeuge: ${names}.`,
      es: `Conectado. Coches: ${names}.`,
    });
    if (calls === null) {
      return head;
    }
    return `${head} ${pick(language, {
      en: `Calls left today: ${calls}.`,
      fr: `Appels restants aujourd'hui : ${calls}.`,
      de: `Verbleibende Aufrufe heute: ${calls}.`,
      es: `Llamadas restantes hoy: ${calls}.`,
    })}`;
  });
}

export const ACTION_MESSAGES = {
  unknownCar: t({
    en: 'This device is not a car of the linked myAudi account.',
    fr: "Cet appareil n'est pas une voiture du compte myAudi relié.",
    de: 'Dieses Gerät ist kein Fahrzeug des verbundenen myAudi-Kontos.',
    es: 'Este dispositivo no es un coche de la cuenta myAudi vinculada.',
  }),
  refreshed: t({
    en: 'Values read again from the Audi cloud.',
    fr: 'Valeurs relues depuis le cloud Audi.',
    de: 'Werte erneut aus der Audi-Cloud gelesen.',
    es: 'Valores leídos de nuevo desde la nube de Audi.',
  }),
  woken: t({
    en: 'The car sent fresh values.',
    fr: 'La voiture a envoyé des valeurs fraîches.',
    de: 'Das Fahrzeug hat frische Werte gesendet.',
    es: 'El coche ha enviado valores nuevos.',
  }),
  flashing: t({
    en: 'The car flashes its lights.',
    fr: 'La voiture fait clignoter ses feux.',
    de: 'Das Fahrzeug lässt die Lichter blinken.',
    es: 'El coche hace parpadear sus luces.',
  }),
  noPosition: t({
    en: 'The car shares no parking position: it cannot flash its lights from here.',
    fr: 'La voiture ne partage pas sa position : impossible de faire clignoter ses feux.',
    de: 'Das Fahrzeug teilt keine Parkposition: Die Lichter können nicht blinken.',
    es: 'El coche no comparte su posición: no puede hacer parpadear sus luces.',
  }),
  climateStarted: t({
    en: 'Climate start sent to the car.',
    fr: 'Démarrage de la climatisation envoyé à la voiture.',
    de: 'Start der Klimatisierung an das Fahrzeug gesendet.',
    es: 'Inicio de la climatización enviado al coche.',
  }),
  climateStopped: t({
    en: 'Climate stop sent to the car.',
    fr: 'Arrêt de la climatisation envoyé à la voiture.',
    de: 'Stopp der Klimatisierung an das Fahrzeug gesendet.',
    es: 'Parada de la climatización enviada al coche.',
  }),
};

/** A failed action, with the reason (technical, English). */
export const failed = (reason) =>
  t({
    en: `Failed: ${reason}`,
    fr: `Échec : ${reason}`,
    de: `Fehlgeschlagen: ${reason}`,
    es: `Error: ${reason}`,
  });
