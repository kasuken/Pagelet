// Entry point for Azure Static Web Apps managed Functions (programming model v4).
// Importing this module registers every HTTP trigger; there are no timer or queue triggers.
import './functions/routes.js';
import './functions/catalog.js';
import './functions/payments.js';
import './functions/owner.js';
import './functions/storefront.js';
import './functions/learning.js';
