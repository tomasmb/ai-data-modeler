import React from 'react';

const EXAMPLE_SCHEMA = `// E-commerce Data Model Example
entity Product {
  id: ID @primary
  name: string @nullable(false)
  description: text
  price: decimal @nullable(false)
  inStock: boolean @default(false)
  createdAt: datetime @default(now)
  sku: string @unique @index
  weight: decimal
  dimensions: json
  // Stores height, width, length
  tags: string[]
  // References category by name instead of id
  category: Category.name @index
  // References Review entity with many relationship
  reviews: Review[]
}

entity Category {
  id: ID @primary
  name: string @unique @nullable(false)
  description: text
  slug: string @unique @index
  status: enum(active,archived,draft) @default(active)
  products: Product[]
}

entity Review {
  id: ID @primary
  rating: number @nullable(false)
  comment: text
  createdAt: datetime @default(now)
  isVerified: boolean @default(false)
  // References product by SKU
  product: Product.sku @index
  // References user by email
  user: User.email @index
}

entity User {
  id: ID @primary
  email: string @unique @index
  name: string @nullable(false)
  status: enum(active,suspended,deleted) @default(active)
  createdAt: datetime @default(now)
  lastLogin: datetime
  preferences: json
  reviews: Review[]
  orders: Order[]
}

entity Order {
  id: ID @primary
  orderNumber: string @unique @index
  totalAmount: decimal @nullable(false)
  status: enum(pending,paid,shipped,delivered,cancelled) @default(pending)
  createdAt: datetime @default(now)
  shippingAddress: json
  // References user by email
  user: User.email @index
  items: OrderItem[]
}

entity OrderItem {
  id: ID @primary
  quantity: int @nullable(false)
  price: decimal @nullable(false)
  discount: decimal @default(0)
  // References order by orderNumber
  order: Order.orderNumber @index
  // References product by SKU
  product: Product.sku @index
}`;

export const ExampleSchemaModal = ({ isOpen, onClose, onApply }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-xl font-semibold">Example Data Model</h2>
          <button
            className="text-gray-600 hover:text-gray-800"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="p-4">
          <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-[70vh] font-mono text-sm">
            <code>{EXAMPLE_SCHEMA}</code>
          </pre>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={() => {
              onApply(EXAMPLE_SCHEMA);
              onClose();
            }}
          >
            Use This Example
          </button>
        </div>
      </div>
    </div>
  );
}; 