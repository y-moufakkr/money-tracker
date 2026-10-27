type SeedCategory = {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  icon: string;
  color: string;
  essential?: 0 | 1;
  parentId?: string;
  system?: boolean;
};

/** Stable IDs so the same default category matches across devices and backups. */
export const SYSTEM_CATEGORY = {
  bankFees: 'sys-cat-bank-fees',
  otherIncome: 'sys-cat-other-income',
  miscellaneous: 'sys-cat-miscellaneous',
} as const;

export const DEFAULT_CATEGORIES: SeedCategory[] = [
  { id: 'sys-cat-groceries', name: 'Groceries', kind: 'expense', icon: 'shopping_cart', color: '#2E9E6A', essential: 1 },
  { id: 'sys-cat-meat-fish', name: 'Meat & Fish', kind: 'expense', icon: 'set_meal', color: '#C2453B', essential: 1 },
  { id: 'sys-cat-veg-fruit', name: 'Vegetables & Fruit', kind: 'expense', icon: 'nutrition', color: '#5DA831', essential: 1 },
  { id: 'sys-cat-snacks', name: 'Snacks', kind: 'expense', icon: 'cookie', color: '#D98A1F', essential: 0 },
  { id: 'sys-cat-restaurants', name: 'Restaurants', kind: 'expense', icon: 'restaurant', color: '#D4572A', essential: 0 },
  { id: 'sys-cat-coffee', name: 'Coffee', kind: 'expense', icon: 'local_cafe', color: '#8A5A3B', essential: 0 },
  { id: 'sys-cat-petrol', name: 'Petrol', kind: 'expense', icon: 'local_gas_station', color: '#3F6FD8', essential: 1 },
  { id: 'sys-cat-transport', name: 'Transport', kind: 'expense', icon: 'directions_bus', color: '#2B8FB3', essential: 1 },
  { id: 'sys-cat-car-maintenance', name: 'Car Maintenance', kind: 'expense', icon: 'car_repair', color: '#56708A' },
  { id: 'sys-cat-electricity', name: 'Electricity', kind: 'expense', icon: 'bolt', color: '#E0B000', essential: 1 },
  { id: 'sys-cat-water', name: 'Water', kind: 'expense', icon: 'water_drop', color: '#1F8DD6', essential: 1 },
  { id: 'sys-cat-gas', name: 'Gas', kind: 'expense', icon: 'local_fire_department', color: '#E06A2B', essential: 1 },
  { id: 'sys-cat-internet', name: 'Internet', kind: 'expense', icon: 'wifi', color: '#6C5CE0', essential: 1 },
  { id: 'sys-cat-mobile', name: 'Mobile', kind: 'expense', icon: 'smartphone', color: '#8656C9', essential: 1 },
  { id: 'sys-cat-healthcare', name: 'Healthcare', kind: 'expense', icon: 'medical_services', color: '#D23C6E', essential: 1 },
  { id: 'sys-cat-pregnancy', name: 'Pregnancy', kind: 'expense', icon: 'pregnant_woman', color: '#E36FA4', essential: 1 },
  { id: 'sys-cat-child', name: 'Child Expenses', kind: 'expense', icon: 'child_care', color: '#F08A5D', essential: 1 },
  { id: 'sys-cat-clothes', name: 'Clothes', kind: 'expense', icon: 'checkroom', color: '#A0559E' },
  { id: 'sys-cat-gym', name: 'Gym', kind: 'expense', icon: 'fitness_center', color: '#3C9D9B' },
  { id: 'sys-cat-supplements', name: 'Supplements', kind: 'expense', icon: 'medication', color: '#4AA88C' },
  { id: 'sys-cat-entertainment', name: 'Entertainment', kind: 'expense', icon: 'movie', color: '#B5466B', essential: 0 },
  { id: 'sys-cat-house-maintenance', name: 'House Maintenance', kind: 'expense', icon: 'home_repair_service', color: '#7A6F5A' },
  { id: 'sys-cat-gifts', name: 'Gifts', kind: 'expense', icon: 'redeem', color: '#CF4F8F', essential: 0 },
  { id: 'sys-cat-business', name: 'Business Expenses', kind: 'expense', icon: 'business_center', color: '#45556B' },
  { id: SYSTEM_CATEGORY.bankFees, name: 'Bank fees', kind: 'expense', icon: 'account_balance', color: '#6B7280', system: true },
  { id: SYSTEM_CATEGORY.miscellaneous, name: 'Miscellaneous', kind: 'expense', icon: 'category', color: '#8B8F98', system: true },

  { id: 'sys-cat-salary', name: 'Salary', kind: 'income', icon: 'work', color: '#2E9E6A' },
  { id: 'sys-cat-dividends', name: 'Dividends', kind: 'income', icon: 'trending_up', color: '#1F8A70' },
  { id: 'sys-cat-freelancing', name: 'Freelancing', kind: 'income', icon: 'laptop_mac', color: '#3F6FD8' },
  { id: 'sys-cat-distributions', name: 'Business distributions', kind: 'income', icon: 'business_center', color: '#45556B' },
  { id: 'sys-cat-gifts-received', name: 'Gifts received', kind: 'income', icon: 'redeem', color: '#CF4F8F' },
  { id: 'sys-cat-refunds', name: 'Refunds', kind: 'income', icon: 'undo', color: '#D98A1F' },
  { id: SYSTEM_CATEGORY.otherIncome, name: 'Other income', kind: 'income', icon: 'add_card', color: '#8B8F98', system: true },
];
