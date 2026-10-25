# Audi Connect

Suivez vos Audi dans Gladys : batterie et charge, carburant, autonomie, kilométrage, verrous,
portes et fenêtres, climatisation et position de stationnement. Démarrez ou arrêtez la charge et
la climatisation, réglez l'objectif de charge, verrouillez et déverrouillez, depuis Gladys, une
scène ou le tableau de bord.

L'intégration lit le cloud Audi (myAudi) : les mêmes données que l'application myAudi.

## Avant de commencer

- **Gladys 5.3 ou plus récent**.
- Un **compte myAudi** où votre voiture est ajoutée, avec les services Audi connect actifs
  (comme dans l'application myAudi).
- Un compte créé en **Europe** ou au **Canada**. Les comptes des États-Unis et de Chine ne sont
  pas pris en charge.
- Facultatif : votre **S-PIN** (code de sécurité myAudi à 4 chiffres), seulement pour verrouiller
  et déverrouiller depuis Gladys.
- Certaines valeurs et commandes dépendent de la voiture et de son contrat connect : une voiture
  qui ne remonte pas une valeur n'a simplement pas la fonctionnalité correspondante.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Choisissez votre **Marché** : Europe (tous les pays européens) ou Canada. Enregistrez.
3. Cliquez sur **Connecter** à côté de **Compte myAudi**. Une page Audi s'ouvre : connectez-vous
   avec votre compte myAudi et validez le code affiché. L'écran de configuration affiche le même
   code pendant l'attente (10 minutes au plus).
4. Une fois validé, le statut passe à connecté et vos voitures apparaissent dans l'onglet
   **Découverte** : ajoutez-les.
5. Facultatif : renseignez votre **S-PIN** pour verrouiller et déverrouiller depuis Gladys.
6. Facultatif : changez l'**Intervalle de rafraîchissement**, 15 minutes par défaut (de 5 minutes
   à 1 heure).

Pourquoi pas de mot de passe ? Audi n'autorise plus les applications tierces à se connecter par
mot de passe. La connexion sur la page Audi est la méthode qu'Audi accepte encore. L'intégration
garde la connexion (un jeton, conservé par Gladys, jamais affiché) et la renouvelle seule : vous
ne vous connectez qu'une fois.

## Ce que montre chaque voiture

| Fonctionnalité                  | Voitures                  | Commande                            |
| ------------------------------- | ------------------------- | ----------------------------------- |
| Kilométrage                     | toutes                    |                                     |
| Niveau de batterie              | électriques et hybrides   |                                     |
| Autonomie électrique            | électriques et hybrides   |                                     |
| Autonomie                       | essence, diesel, hybrides |                                     |
| Niveau de carburant             | essence, diesel, hybrides |                                     |
| Charge                          | électriques et hybrides   | démarrer / arrêter                  |
| Branchée                        | électriques et hybrides   |                                     |
| Puissance de charge             | électriques et hybrides   |                                     |
| Temps de charge restant         | électriques et hybrides   |                                     |
| Objectif de charge              | électriques et hybrides   | de 20 à 100 %                       |
| Climatisation                   | si prise en charge        | démarrer / arrêter                  |
| Température de la climatisation | si prise en charge        | utilisée au prochain démarrage      |
| Verrouillée                     | toutes                    | verrouiller / déverrouiller (S-PIN) |
| Porte ouverte, Fenêtre ouverte  | toutes                    |                                     |
| Entretien dans (jours, km)      | si remonté                | négatif en cas de retard            |
| Position de stationnement       | si partagée               | latitude, longitude                 |

Un badge sur chaque voiture affiche **cloud** quand la dernière lecture a réussi, **injoignable**
quand elle a échoué.

Les commandes prennent du temps : la voiture reçoit l'ordre via le cloud Audi et l'exécute dans
la minute. Gladys affiche le nouvel état une fois confirmé par la voiture, et la voiture est
relue 20 secondes plus tard.

## Boutons de la configuration

- **Tester la connexion** : se reconnecte, liste vos voitures et les appels restants pour
  aujourd'hui.
- **Rafraîchir une voiture** : relit une voiture tout de suite. Cochez **Réveiller la voiture**
  pour demander des valeurs fraîches à la voiture elle-même (jusqu'à 2 minutes ; cela sollicite
  la batterie 12 V, donc pas trop souvent).
- **Faire clignoter les feux** : la voiture fait clignoter ses feux pendant 10 secondes, pour la
  retrouver sur un parking (il faut sa position de stationnement).

## Scènes

L'intégration ajoute ses propres cartes à l'éditeur de scènes (Gladys 5.1 ou plus récent).

Déclencheurs :

- **L'état de charge a changé** : en charge, terminée (objectif atteint), pas en charge, erreur.
  Filtrez sur une voiture et sur le nouvel état. Variables : nom de la voiture, état, niveau de
  batterie, autonomie.
- **Voiture verrouillée ou déverrouillée** : l'état de verrouillage a changé entre deux lectures.
  Variables : nom de la voiture, état (`locked` / `unlocked`).
- **Une commande de voiture a échoué** : la voiture ou le cloud Audi a refusé un ordre
  (verrouillage, charge, climatisation…). Variables : nom de la voiture, commande, raison
  (`spin_missing`, `spin_refused`, `failed`, `error`…), message.

Actions :

- **Lancer la climatisation d'une voiture**, avec une température facultative (16 à 30 °C ; vide :
  les réglages de la voiture). Sorties : démarrage accepté, confirmé par la voiture.
- **Arrêter la climatisation d'une voiture**. Sorties : arrêt accepté, confirmé par la voiture.
- **Relire une voiture**, en la réveillant si besoin. Sorties : niveau de batterie, autonomie,
  niveau de carburant, kilométrage, verrouillée, en charge, branchée, climatisation en marche —
  utilisables par les actions suivantes.

Exemple : « chaque jour de semaine à 7 h 30, si la batterie est sous 30 %, démarrer la charge ;
à 7 h 45, lancer la climatisation à 21 °C ».

## Tableau de bord

Ajoutez le widget **Voiture Audi** et choisissez la voiture (la première si vide). Il affiche en
direct la jauge de batterie (ou de carburant), l'autonomie et le kilométrage, les verrous, portes
et fenêtres, la charge et la climatisation, l'heure du dernier relevé, et des boutons :
actualiser, lancer/arrêter la clim, verrouiller (jamais déverrouiller depuis un tableau de bord),
et un lien vers la carte de la position de stationnement.

## Limites

- Audi limite le nombre d'appels par compte et par jour. Chaque lecture d'une voiture coûte deux
  appels : gardez un intervalle de 15 minutes ou plus si vous avez plusieurs voitures. **Tester
  la connexion** indique les appels restants aujourd'hui.
- Les valeurs sont celles que la voiture a envoyées en dernier au cloud. Une voiture garée et
  endormie n'envoie rien : utilisez **Réveiller la voiture** quand il vous faut des valeurs
  fraîches.

## Dépannage

- **« Aucun compte myAudi relié »** : cliquez sur **Connecter** et validez le code sur la page
  Audi.
- **« Audi a refusé la connexion enregistrée »** : le lien a été révoqué (mot de passe changé
  dans myAudi, compte supprimé…). Cliquez de nouveau sur **Connecter**.
- **Le verrouillage échoue** avec `spin_missing` / `spin_refused` : renseignez le bon S-PIN.
- **Une valeur manque** : la voiture ne la remonte pas, ou le service ne fait pas partie de son
  contrat connect. Vérifiez dans l'application myAudi.
- Activez **Journaux détaillés** dans la configuration, reproduisez le problème, puis lisez les
  journaux de l'intégration. E-mail, mots de passe, jetons et S-PIN ne sont jamais journalisés.
