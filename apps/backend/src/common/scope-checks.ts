import { NotFoundException } from "@nestjs/common";

export async function assertWarehouseInOrganization(
  tx: { warehouse: { findFirst(args: { where: { id: string; organizationId: string } }): Promise<unknown> } },
  warehouseId: string,
  organizationId: string
) {
  const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, organizationId } });
  if (!warehouse) throw new NotFoundException("Warehouse not found");
}

export async function assertProductTypeExists(
  tx: { productType: { findUnique(args: { where: { id: string } }): Promise<unknown> } },
  productTypeId: string
) {
  const productType = await tx.productType.findUnique({ where: { id: productTypeId } });
  if (!productType) throw new NotFoundException("Product type not found");
}

export async function assertMaterialTypeExists(
  tx: { materialType: { findUnique(args: { where: { id: string } }): Promise<unknown> } },
  materialTypeId: string
) {
  const materialType = await tx.materialType.findUnique({ where: { id: materialTypeId } });
  if (!materialType) throw new NotFoundException("Material type not found");
}

export async function assertItemTypeReferences(
  tx: {
    materialType: { findUnique(args: { where: { id: string } }): Promise<unknown> };
    productType: { findUnique(args: { where: { id: string } }): Promise<unknown> };
  },
  item: { materialTypeId?: string | null; productTypeId?: string | null }
) {
  if (item.materialTypeId) await assertMaterialTypeExists(tx, item.materialTypeId);
  if (item.productTypeId) await assertProductTypeExists(tx, item.productTypeId);
}
