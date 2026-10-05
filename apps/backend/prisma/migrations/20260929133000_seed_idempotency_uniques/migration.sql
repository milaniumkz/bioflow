CREATE UNIQUE INDEX "Counterparty_organizationId_name_key" ON "Counterparty"("organizationId", "name");
CREATE UNIQUE INDEX "Driver_organizationId_phone_key" ON "Driver"("organizationId", "phone");
CREATE UNIQUE INDEX "ExtractionSite_organizationId_name_key" ON "ExtractionSite"("organizationId", "name");
CREATE UNIQUE INDEX "Warehouse_organizationId_name_key" ON "Warehouse"("organizationId", "name");
