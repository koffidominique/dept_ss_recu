import type {
  ApiClient,
  CreateSaleReturnPayload,
  ReceivePurchaseOrderPayload,
} from './ApiClient.ts';
import {
  httpAuthApi,
  httpCatalogApi,
  httpPurchasesApi,
  httpSalesApi,
} from './http/httpCommerceRoutes.ts';
import { httpOrdersApi } from './http/httpOrdersRoutes.ts';
import { httpDeliveryApi } from './http/httpDeliveryRoutes.ts';
import { httpCommercialDocumentsApi } from './http/httpCommercialDocuments.ts';
import {
  httpConsignmentsApi,
  httpFinanceApi,
  httpStockApi,
  httpSystemApi,
} from './http/httpOperationsRoutes.ts';

/* ============================================================================
 * Client HTTP (mode navigateur / serveur Axum) implémentant ApiClient
 * ============================================================================ */

export class HttpApiClient implements ApiClient {
  listCommercialDocuments = httpCommercialDocumentsApi.listCommercialDocuments;
  getCommercialDocumentDetail = httpCommercialDocumentsApi.getCommercialDocumentDetail;
  submitCommercialDocument = httpCommercialDocumentsApi.submitCommercialDocument;
  reviewCommercialDocument = httpCommercialDocumentsApi.reviewCommercialDocument;
  getCommercialDocumentEvents = httpCommercialDocumentsApi.getCommercialDocumentEvents;

  /* --- Authentification & Tableau de bord --- */
  getAuthStatus = httpAuthApi.getAuthStatus;
  setupPin = httpAuthApi.setupPin;
  login = httpAuthApi.login;
  lock = httpAuthApi.lock;
  changePin = httpAuthApi.changePin;
  getMe = httpAuthApi.getMe;
  listUsers = httpAuthApi.listUsers;
  createUser = httpAuthApi.createUser;
  toggleUser = httpAuthApi.toggleUser;
  getDashboard = httpAuthApi.getDashboard;

  /* --- Catégories & Produits --- */
  listCategories = httpCatalogApi.listCategories;
  createCategory = httpCatalogApi.createCategory;
  updateCategory = httpCatalogApi.updateCategory;
  listProducts = httpCatalogApi.listProducts;
  createProduct = httpCatalogApi.createProduct;
  updateProduct = httpCatalogApi.updateProduct;
  deleteProduct = httpCatalogApi.deleteProduct;
  upsertPackaging = httpCatalogApi.upsertPackaging;
  listBreweries = httpCatalogApi.listBreweries;
  createBrewery = httpCatalogApi.createBrewery;
  listBrandsV4 = httpCatalogApi.listBrandsV4;
  createBrandV4 = httpCatalogApi.createBrandV4;
  listContainerTypesV4 = httpCatalogApi.listContainerTypesV4;
  listPackagingTypesV4 = httpCatalogApi.listPackagingTypesV4;
  listStockLocationsV4 = httpCatalogApi.listStockLocationsV4;
  listCrateTypes = httpCatalogApi.listCrateTypes;
  createCrateType = httpCatalogApi.createCrateType;
  updateCrateType = httpCatalogApi.updateCrateType;
  deleteCrateType = httpCatalogApi.deleteCrateType;
  // Packaging Profiles
  listPackagingProfiles = httpCatalogApi.listPackagingProfiles;
  createPackagingProfile = httpCatalogApi.createPackagingProfile;
  updatePackagingProfile = httpCatalogApi.updatePackagingProfile;
  deletePackagingProfile = httpCatalogApi.deletePackagingProfile;
  // Variant Packaging Options
  listVariantPackagingOptions = httpCatalogApi.listVariantPackagingOptions;
  createVariantPackagingOption = httpCatalogApi.createVariantPackagingOption;
  updateVariantPackagingOption = httpCatalogApi.updateVariantPackagingOption;
  deleteVariantPackagingOption = httpCatalogApi.deleteVariantPackagingOption;
  // Catalogue Verification Logs
  listCatalogueVerificationLogs = httpCatalogApi.listCatalogueVerificationLogs;
  // Return Packaging Calculation
  calculateLineReturnPackaging = httpCatalogApi.calculateLineReturnPackaging;
  calculateSaleReturnPackaging = httpCatalogApi.calculateSaleReturnPackaging;
  checkCrateMixCompatibility = httpCatalogApi.checkCrateMixCompatibility;
  getPosPackagingDisplay = httpCatalogApi.getPosPackagingDisplay;
  listSalesUnits = httpCatalogApi.listSalesUnits;
  createSalesUnit = httpCatalogApi.createSalesUnit;
  updateSalesUnit = httpCatalogApi.updateSalesUnit;
  deleteSalesUnit = httpCatalogApi.deleteSalesUnit;
  listProductSuppliers = httpCatalogApi.listProductSuppliers;
  upsertProductSupplier = httpCatalogApi.upsertProductSupplier;
  listDepositRules = httpCatalogApi.listDepositRules;
  exportProductsCsv = httpCatalogApi.exportProductsCsv;
  importProductsCsv = httpCatalogApi.importProductsCsv;
  listCatalogPresets = httpCatalogApi.listCatalogPresets;
  applyCatalogPresets = httpCatalogApi.applyCatalogPresets;

  /* --- Clients, Ventes & Créances --- */
  listClients = httpSalesApi.listClients;
  createClient = httpSalesApi.createClient;
  updateClient = httpSalesApi.updateClient;
  updateClientCredit = httpSalesApi.updateClientCredit;
  listSales = httpSalesApi.listSales;
  getSaleDetail = httpSalesApi.getSaleDetail;
  createSale = httpSalesApi.createSale;
  cancelSale = httpSalesApi.cancelSale;
  createSaleReturn = (saleId: number, input: CreateSaleReturnPayload) =>
    httpSalesApi.createSaleReturn(saleId, input);
  listReceivables = httpSalesApi.listReceivables;
  payReceivable = httpSalesApi.payReceivable;
  getPaymentReceipt = httpSalesApi.getPaymentReceipt;
  getClientPackagingBalances = httpSalesApi.getClientPackagingBalances;

  /* --- Fournisseurs, Commandes & Dettes --- */
  listSuppliers = httpPurchasesApi.listSuppliers;
  createSupplier = httpPurchasesApi.createSupplier;
  updateSupplier = httpPurchasesApi.updateSupplier;
  listPurchases = httpPurchasesApi.listPurchases;
  createPurchaseOrder = httpPurchasesApi.createPurchaseOrder;
  updatePurchaseOrder = httpPurchasesApi.updatePurchaseOrder;
  receivePurchaseOrder = (orderId: number, input: ReceivePurchaseOrderPayload) =>
    httpPurchasesApi.receivePurchaseOrder(orderId, input);
  listPurchaseOrderReceipts = httpPurchasesApi.listPurchaseOrderReceipts;
  getPurchaseReceiptDetail = httpPurchasesApi.getPurchaseReceiptDetail;
  listPurchaseDocumentSnapshots = httpPurchasesApi.listPurchaseDocumentSnapshots;
  cancelPurchaseOrder = httpPurchasesApi.cancelPurchaseOrder;
  listSupplierDebts = httpPurchasesApi.listSupplierDebts;
  paySupplierDebt = httpPurchasesApi.paySupplierDebt;

  /* --- Stocks & Inventaires --- */
  getStockOverview = httpStockApi.getStockOverview;
  adjustStock = httpStockApi.adjustStock;
  listInventories = httpStockApi.listInventories;
  createInventory = httpStockApi.createInventory;
  validateInventory = httpStockApi.validateInventory;

  /* --- Consignations & Catalogue central --- */
  getConsignmentsOverview = httpConsignmentsApi.getConsignmentsOverview;
  createReturnableType = httpConsignmentsApi.createReturnableType;
  adjustReturnableStock = httpConsignmentsApi.adjustReturnableStock;
  returnClientEmpties = httpConsignmentsApi.returnClientEmpties;
  listPackagingObligations = httpConsignmentsApi.listPackagingObligations;
  getPackagingDashboard = httpConsignmentsApi.getPackagingDashboard;
  payPackagingDebt = httpConsignmentsApi.payPackagingDebt;
  processDuePackagingObligations = httpConsignmentsApi.processDuePackagingObligations;
  registerPackagingLateReturn = httpConsignmentsApi.registerPackagingLateReturn;
  listPackagingLossDeclarations = httpConsignmentsApi.listPackagingLossDeclarations;
  declarePackagingLoss = httpConsignmentsApi.declarePackagingLoss;
  validatePackagingLoss = httpConsignmentsApi.validatePackagingLoss;
  getProductCatalogueOverview = httpConsignmentsApi.getProductCatalogueOverview;
  setCatalogueProductActive = httpConsignmentsApi.setCatalogueProductActive;
  setCatalogueReferencePrice = httpConsignmentsApi.setCatalogueReferencePrice;
  getCatalogueReferencePriceHistory = httpConsignmentsApi.getCatalogueReferencePriceHistory;

  /* --- Caisse, Dépenses & Rapports --- */
  getCashStatus = httpFinanceApi.getCashStatus;
  openCashSession = httpFinanceApi.openCashSession;
  closeCashSession = httpFinanceApi.closeCashSession;
  listExpenses = httpFinanceApi.listExpenses;
  createExpense = httpFinanceApi.createExpense;
  getReports = httpFinanceApi.getReports;

  /* --- Commandes mixtes & consignes --- */
  composeOrderPreview = httpOrdersApi.composeOrderPreview;
  listCustomerOrders = httpOrdersApi.listCustomerOrders;
  getCustomerOrder = httpOrdersApi.getCustomerOrder;
  issueCustomerOrderReceipt = httpOrdersApi.issueCustomerOrderReceipt;
  listCustomerOrderReceipts = httpOrdersApi.listCustomerOrderReceipts;
  reviseCustomerOrderReceipt = httpOrdersApi.reviseCustomerOrderReceipt;
  createCustomerOrder = httpOrdersApi.createCustomerOrder;
  updateCustomerOrder = httpOrdersApi.updateCustomerOrder;
  confirmCustomerOrder = httpOrdersApi.confirmCustomerOrder;
  deliverCustomerOrder = httpOrdersApi.deliverCustomerOrder;
  invoiceCustomerOrder = httpOrdersApi.invoiceCustomerOrder;
  payCustomerOrder = httpOrdersApi.payCustomerOrder;
  cancelCustomerOrder = httpOrdersApi.cancelCustomerOrder;
  returnOrderPackaging = httpOrdersApi.returnOrderPackaging;
  listPackagingAssets = httpOrdersApi.listPackagingAssets;
  getCustomerDeposits = httpOrdersApi.getCustomerDeposits;
  getCustomerDepositHistory = httpOrdersApi.getCustomerDepositHistory;
  returnCustomerDeposits = httpOrdersApi.returnCustomerDeposits;

  /* --- Tournées de livraison --- */
  listDeliveryRuns = httpDeliveryApi.listDeliveryRuns;
  getDeliveryRun = httpDeliveryApi.getDeliveryRun;
  createDeliveryRun = httpDeliveryApi.createDeliveryRun;
  addDeliveryStop = httpDeliveryApi.addDeliveryStop;
  loadDeliveryRun = httpDeliveryApi.loadDeliveryRun;
  startDeliveryRun = httpDeliveryApi.startDeliveryRun;
  cancelDeliveryRun = httpDeliveryApi.cancelDeliveryRun;
  declareDeliveryCollection = httpDeliveryApi.declareDeliveryCollection;
  recordDeliveryStopOutcome = httpDeliveryApi.recordDeliveryStopOutcome;
  recordDeliveryRunReturn = httpDeliveryApi.recordDeliveryRunReturn;
  returnDeliveryRun = httpDeliveryApi.returnDeliveryRun;
  reconcileDeliveryRun = httpDeliveryApi.reconcileDeliveryRun;
  getDeliveryReconciliation = httpDeliveryApi.getDeliveryReconciliation;

  /* --- Paramètres, Sauvegardes & PDF --- */
  getSettings = httpSystemApi.getSettings;
  updateSettings = httpSystemApi.updateSettings;
  addPaymentMethod = httpSystemApi.addPaymentMethod;
  togglePaymentMethod = httpSystemApi.togglePaymentMethod;
  listBackups = httpSystemApi.listBackups;
  getLocalDbStatus = httpSystemApi.getLocalDbStatus;
  createBackup = httpSystemApi.createBackup;
  createEncryptedBackup = httpSystemApi.createEncryptedBackup;
  importBackup = httpSystemApi.importBackup;
  verifyBackup = httpSystemApi.verifyBackup;
  verifyEncryptedBackup = httpSystemApi.verifyEncryptedBackup;
  restoreBackup = httpSystemApi.restoreBackup;
  restoreEncryptedBackup = httpSystemApi.restoreEncryptedBackup;
  downloadBackup = httpSystemApi.downloadBackup;
  generateDocumentPdf = httpSystemApi.generateDocumentPdf;
  shutdownApp = httpSystemApi.shutdownApp;
}
