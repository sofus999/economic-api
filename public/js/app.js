// Main application script
document.addEventListener('DOMContentLoaded', () => {
  // Fix for initialization
  console.log("DOM content loaded - initializing app");
  window.isAppInitialized = true;
  
  // Make switchTab function globally available
  window.switchTab = function(tabId) {
    // Hide all tab contents
    document.querySelectorAll('.tab-pane').forEach(tab => {
      tab.classList.remove('show', 'active');
    });
    
    // Deactivate all tab buttons
    document.querySelectorAll('.nav-link').forEach(button => {
      button.classList.remove('active');
      button.setAttribute('aria-selected', 'false');
    });
    
    // Show selected tab content
    const selectedTab = document.getElementById(tabId + '-content');
    if (selectedTab) {
      selectedTab.classList.add('show', 'active');
    }
    
    // Activate selected tab button
    const selectedButton = document.getElementById(tabId + '-tab');
    if (selectedButton) {
      selectedButton.classList.add('active');
      selectedButton.setAttribute('aria-selected', 'true');
    }
  };

  // Router setup
  const routes = {
    '/': showAccountsList,
    '/accounts': showAccountsList,
    '/accounts/:agreement_number/:account_number': showAccountDetails
  };

  // State management
  const state = {
    accounts: [],
    currentAccount: null,
    entries: {
      data: [],
      page: 1,
      limit: 50,
      total: 0,
      fromDate: null,
      toDate: null
    },
    invoices: {
      data: [],
      page: 1,
      limit: 20,
      total: 0
    },
    monthlyBalances: []
  };

  // Format currency with a given locale
  function formatCurrency(amount, locale = 'da-DK', currency = 'DKK') {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency
    }).format(amount);
  }

  // Format date with a given locale
  function formatDate(dateString, locale = 'da-DK') {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }

  // Get CSS class based on amount
  function getAmountClass(amount) {
    if (amount > 0) return 'positive-amount';
    if (amount < 0) return 'negative-amount';
    return 'neutral-amount';
  }

  // Get CSS class for payment status
  function getStatusClass(status) {
    const statusMap = {
      'paid': 'status-paid',
      'pending': 'status-pending',
      'overdue': 'status-overdue',
      'draft': 'status-draft',
      'partial': 'status-partial'
    };
    return statusMap[status] || 'status-pending';
  }

  // Get status display text
  function getStatusText(status) {
    const statusMap = {
      'paid': 'Paid',
      'pending': 'Pending',
      'overdue': 'Overdue',
      'draft': 'Draft',
      'partial': 'Partial'
    };
    return statusMap[status] || 'Pending';
  }

  // Get month name
  function getMonthName(month) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[month - 1];
  }

  // Fetch all accounts
  async function fetchAccounts() {
    try {
      const response = await fetch('/api/accounts');
      if (!response.ok) {
        throw new Error('Failed to fetch accounts');
      }
      state.accounts = await response.json();
      return state.accounts;
    } catch (error) {
      console.error('Error fetching accounts:', error);
      return [];
    }
  }

  // Fetch account by number and agreement
  async function fetchAccountByNumber(agreementNumber, accountNumber) {
    try {
      const response = await fetch(`/api/accounts/agreements/${agreementNumber}/${accountNumber}`);
      if (!response.ok) {
        throw new Error('Failed to fetch account');
      }
      state.currentAccount = await response.json();
      return state.currentAccount;
    } catch (error) {
      console.error('Error fetching account:', error);
      return null;
    }
  }

  // Fetch account entries
  async function fetchAccountEntries(agreementNumber, accountNumber, page = 1, limit = 50, fromDate = null, toDate = null) {
    try {
      let url = `/api/accounts/${agreementNumber}/${accountNumber}/entries?page=${page}&limit=${limit}`;
      
      if (fromDate) {
        url += `&from_date=${fromDate}`;
      }
      
      if (toDate) {
        url += `&to_date=${toDate}`;
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch account entries');
      }
      
      const data = await response.json();
      state.entries.data = data.entries;
      state.entries.page = page;
      state.entries.limit = limit;
      state.entries.total = data.pagination.total;
      state.entries.fromDate = fromDate;
      state.entries.toDate = toDate;
      
      return data;
    } catch (error) {
      console.error('Error fetching account entries:', error);
      return { entries: [], pagination: { total: 0, page: 1, limit: 50, pages: 0 } };
    }
  }

  // Fetch account invoices
  async function fetchAccountInvoices(agreementNumber, accountNumber, page = 1, limit = 20) {
    try {
      const response = await fetch(`/api/accounts/${agreementNumber}/${accountNumber}/invoices?page=${page}&limit=${limit}`);
      if (!response.ok) {
        throw new Error('Failed to fetch account invoices');
      }
      
      const data = await response.json();
      state.invoices.data = data.invoices;
      state.invoices.page = page;
      state.invoices.limit = limit;
      state.invoices.total = data.pagination.total;
      
      return data;
    } catch (error) {
      console.error('Error fetching account invoices:', error);
      return { invoices: [], pagination: { total: 0, page: 1, limit: 20, pages: 0 } };
    }
  }

  // Fetch monthly balances
  async function fetchMonthlyBalances(agreementNumber, accountNumber, year = null) {
    try {
      let url = `/api/accounts/${agreementNumber}/${accountNumber}/monthly-balances`;
      if (year) {
        url += `?year=${year}`;
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch monthly balances');
      }
      
      const data = await response.json();
      state.monthlyBalances = data.balances;
      
      return data;
    } catch (error) {
      console.error('Error fetching monthly balances:', error);
      return { balances: [] };
    }
  }

  // Render accounts list view
  function renderAccountsList(accounts) {
    const app = document.getElementById('app');
    const template = document.getElementById('accounts-list-template').content.cloneNode(true);
    
    const tableBody = template.querySelector('#accounts-table-body');
    tableBody.innerHTML = '';
    
    // Populate accounts table
    accounts.forEach(account => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${account.account_number}</strong></td>
        <td>${account.name}</td>
        <td>${account.account_type}</td>
        <td class="${getAmountClass(account.balance)}">${formatCurrency(account.balance)}</td>
        <td>
          <a href="/accounts/${account.agreement_number}/${account.account_number}" class="btn btn-sm btn-primary">
            <i class="bi bi-eye"></i> View
          </a>
        </td>
      `;
      
      // Add click event to row
      row.addEventListener('click', () => {
        window.location.href = `/accounts/${account.agreement_number}/${account.account_number}`;
      });
      
      tableBody.appendChild(row);
    });
    
    // Set up year filter
    const yearFilter = template.querySelector('#year-filter');
    const currentYear = new Date().getFullYear();
    yearFilter.innerHTML = '';
    
    // Add last 5 years to filter
    for (let year = currentYear; year >= currentYear - 4; year--) {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = year;
      yearFilter.appendChild(option);
    }
    
    // Set up account search
    const accountSearch = template.querySelector('#account-search');
    accountSearch.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      const filteredAccounts = state.accounts.filter(account => 
        account.account_number.toString().includes(searchTerm) || 
        account.name.toLowerCase().includes(searchTerm)
      );
      
      renderAccountsTable(filteredAccounts);
    });
    
    app.innerHTML = '';
    app.appendChild(template);
  }

  // Update just the accounts table (for filtering)
  function renderAccountsTable(accounts) {
    const tableBody = document.getElementById('accounts-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    accounts.forEach(account => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${account.account_number}</strong></td>
        <td>${account.name}</td>
        <td>${account.account_type}</td>
        <td class="${getAmountClass(account.balance)}">${formatCurrency(account.balance)}</td>
        <td>
          <a href="/accounts/${account.agreement_number}/${account.account_number}" class="btn btn-sm btn-primary">
            <i class="bi bi-eye"></i> View
          </a>
        </td>
      `;
      
      row.addEventListener('click', () => {
        window.location.href = `/accounts/${account.agreement_number}/${account.account_number}`;
      });
      
      tableBody.appendChild(row);
    });
  }

  // Render account details view
  function renderAccountDetails(account, entries, invoices, monthlyBalances) {
    console.log("Rendering account details:", account);
    console.log("Monthly balances:", monthlyBalances);
    
    const app = document.getElementById('app');
    if (!app) {
      console.error("App container not found!");
      return;
    }
    
    try {
      // Get the template for account details
      const templateElement = document.getElementById('account-details-template');
      if (!templateElement) {
        console.error("Account details template not found!");
        app.innerHTML = '<div class="alert alert-danger">Error: Account details template not found!</div>';
        return;
      }
      
      const template = templateElement.content.cloneNode(true);
      
      // Fill account details
      template.querySelector('.account-title').textContent = `${account.account_number} - ${account.name}`;
      template.querySelector('.account-type').textContent = account.account_type;
      
      const balanceElement = template.querySelector('.account-balance');
      balanceElement.textContent = formatCurrency(account.balance);
      balanceElement.classList.add(getAmountClass(account.balance));
      
      template.querySelector('.account-number').textContent = account.account_number;
      template.querySelector('.account-type-detail').textContent = account.account_type;
      
      // Format the last updated date if available
      const lastUpdated = account.last_entry_date || account.updated_at || new Date().toISOString();
      template.querySelector('.account-last-updated').textContent = formatDate(lastUpdated);
      
      // Set up back button
      template.querySelector('#back-button').addEventListener('click', () => {
        window.location.href = '/accounts';
      });
      
      // Add content to the page first
      app.innerHTML = '';
      app.appendChild(template);
      
      // Initialize Bootstrap tabs
      const tabsElement = document.getElementById('accountTabs');
      if (tabsElement && typeof bootstrap !== 'undefined' && bootstrap.Tab) {
        const tabs = tabsElement.querySelectorAll('[data-bs-toggle="tab"]');
        tabs.forEach(tab => {
          tab.addEventListener('click', (e) => {
            e.preventDefault();
            const tabInstance = new bootstrap.Tab(tab);
            tabInstance.show();
          });
        });
      }
      
      console.log("About to render entries table");
      // Render entries table
      renderEntriesTable(entries);
      
      console.log("About to render invoices table");
      // Render invoices table
      renderInvoicesTable(invoices);
      
      console.log("About to render monthly chart");
      // Set up chart
      renderMonthlyChart(monthlyBalances);
      
      console.log("About to setup form controls");
      // Set up form controls
      setupFormControls(account);
      
      console.log("Account details rendered successfully");
    } catch (error) {
      console.error("Error rendering account details:", error);
      app.innerHTML = `<div class="alert alert-danger">Error rendering account details: ${error.message}</div>`;
    }
  }

  // Render entries table
  function renderEntriesTable(data) {
    try {
      console.log("Rendering entries table with data:", data);
      const tableBody = document.getElementById('entries-table-body');
      if (!tableBody) {
        console.error("Entries table body not found!");
        return;
      }
      
      tableBody.innerHTML = '';
      
      if (!data || !data.entries || data.entries.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td colspan="7" class="text-center">No entries found</td>
        `;
        tableBody.appendChild(row);
        
        if (document.getElementById('entries-count')) {
          document.getElementById('entries-count').textContent = 'No entries found';
        }
        
        return;
      }
      
      // Debug the entries data structure
      console.log("First entry:", data.entries[0]);
      
      data.entries.forEach(entry => {
        const row = document.createElement('tr');
        try {
          // Use optional chaining to avoid errors when properties are missing
          row.innerHTML = `
            <td><strong>${entry.entry_number ?? ''}</strong></td>
            <td>${formatDate(entry.date ?? entry.entry_date)}</td>
            <td>${entry.voucher ?? entry.voucher_number ?? '-'}</td>
            <td>${entry.type ?? entry.entry_type ?? '-'}</td>
            <td>${entry.text ?? entry.entry_text ?? '-'}</td>
            <td class="${getAmountClass(entry.amount)}">${formatCurrency(entry.amount)}</td>
            <td class="${getAmountClass(entry.running_balance ?? entry.balance)}">${formatCurrency(entry.running_balance ?? entry.balance)}</td>
          `;
        } catch (e) {
          console.error("Error formatting entry row:", e, entry);
          row.innerHTML = `<td colspan="7" class="text-danger">Error formatting entry: ${e.message}</td>`;
        }
        
        tableBody.appendChild(row);
      });
      
      // Update pagination info
      const entriesCount = document.getElementById('entries-count');
      if (entriesCount) {
        entriesCount.textContent = `Showing ${data.entries.length} of ${data.pagination?.total || data.entries.length} entries`;
      }
      
      // Update pagination buttons
      const prevButton = document.getElementById('prev-entries');
      const nextButton = document.getElementById('next-entries');
      
      if (prevButton && nextButton && data.pagination) {
        prevButton.disabled = data.pagination.page <= 1;
        nextButton.disabled = data.pagination.page >= data.pagination.pages;
        
        prevButton.onclick = () => {
          if (data.pagination.page > 1) {
            loadAccountEntriesPage(data.pagination.page - 1);
          }
        };
        
        nextButton.onclick = () => {
          if (data.pagination.page < data.pagination.pages) {
            loadAccountEntriesPage(data.pagination.page + 1);
          }
        };
      }
      
      console.log("Entries table rendered successfully");
    } catch (error) {
      console.error("Error rendering entries table:", error);
      const tableBody = document.getElementById('entries-table-body');
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-danger">Error rendering entries: ${error.message}</td></tr>`;
      }
    }
  }

  // Render invoices table
  function renderInvoicesTable(data) {
    try {
      console.log("Rendering invoices table with data:", data);
      const tableBody = document.getElementById('invoices-table-body');
      if (!tableBody) {
        console.error("Invoices table body not found!");
        return;
      }
      
      tableBody.innerHTML = '';
      
      if (!data || !data.invoices || data.invoices.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td colspan="6" class="text-center">No invoices found</td>
        `;
        tableBody.appendChild(row);
        
        if (document.getElementById('invoices-count')) {
          document.getElementById('invoices-count').textContent = 'No invoices found';
        }
        
        return;
      }
      
      // Debug the invoices data structure
      console.log("First invoice:", data.invoices[0]);
      
      data.invoices.forEach(invoice => {
        const row = document.createElement('tr');
        try {
          // Use optional chaining to handle missing properties
          row.innerHTML = `
            <td><strong>${invoice.invoice_number ?? ''}</strong></td>
            <td>${formatDate(invoice.date)}</td>
            <td>${invoice.customer ?? invoice.customer_name ?? ''}</td>
            <td class="${getAmountClass(invoice.amount ?? invoice.gross_amount)}">${formatCurrency(invoice.amount ?? invoice.gross_amount ?? 0)}</td>
            <td><span class="status-badge ${getStatusClass(invoice.status ?? invoice.payment_status)}">${getStatusText(invoice.status ?? invoice.payment_status)}</span></td>
            <td>
              <a href="/api/invoices/${invoice.agreement_number || state.currentAccount?.agreement_number}/${invoice.invoice_number}/pdf" target="_blank" class="btn btn-sm btn-outline-primary">
                <i class="bi bi-file-earmark-pdf"></i> View PDF
              </a>
            </td>
          `;
        } catch (e) {
          console.error("Error formatting invoice row:", e, invoice);
          row.innerHTML = `<td colspan="6" class="text-danger">Error formatting invoice: ${e.message}</td>`;
        }
        
        tableBody.appendChild(row);
      });
      
      // Update pagination info
      const invoicesCount = document.getElementById('invoices-count');
      if (invoicesCount) {
        invoicesCount.textContent = `Showing ${data.invoices.length} of ${data.pagination?.total || data.invoices.length} invoices`;
      }
      
      // Update pagination buttons
      const prevButton = document.getElementById('prev-invoices');
      const nextButton = document.getElementById('next-invoices');
      
      if (prevButton && nextButton && data.pagination) {
        prevButton.disabled = data.pagination.page <= 1;
        nextButton.disabled = data.pagination.page >= data.pagination.pages;
        
        prevButton.onclick = () => {
          if (data.pagination.page > 1) {
            loadAccountInvoicesPage(data.pagination.page - 1);
          }
        };
        
        nextButton.onclick = () => {
          if (data.pagination.page < data.pagination.pages) {
            loadAccountInvoicesPage(data.pagination.page + 1);
          }
        };
      }
      
      console.log("Invoices table rendered successfully");
    } catch (error) {
      console.error("Error rendering invoices table:", error);
      const tableBody = document.getElementById('invoices-table-body');
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-danger">Error rendering invoices: ${error.message}</td></tr>`;
      }
    }
  }

  // Create monthly chart
  function renderMonthlyChart(balances) {
    const chartCanvas = document.getElementById('monthly-chart');
    if (!chartCanvas) {
      console.error("Chart canvas element not found!");
      return;
    }
    
    console.log("Rendering monthly chart with balances:", balances);
    
    // Check if balances exist
    if (!balances || balances.length === 0) {
      chartCanvas.parentElement.innerHTML = '<div class="text-center py-3">No monthly data available</div>';
      return;
    }
    
    // Check if Chart is available
    if (typeof Chart === 'undefined') {
      console.error("Chart.js library not loaded!");
      chartCanvas.parentElement.innerHTML = '<div class="text-center py-3 text-danger">Chart library failed to load</div>';
      return;
    }
    
    // Prepare data for chart
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyData = Array(12).fill(0);
    const balanceData = Array(12).fill(null);
    
    try {
      balances.forEach(balance => {
        // Adjust for different field names based on our database view
        const monthIndex = (balance.month || balance.entry_month) - 1;
        if (monthIndex >= 0 && monthIndex < 12) {
          monthlyData[monthIndex] = parseFloat(balance.monthly_amount || balance.amount) || 0;
          balanceData[monthIndex] = parseFloat(balance.end_of_month_balance || balance.balance) || 0;
        }
      });
    } catch (error) {
      console.error("Error processing balance data:", error);
      console.log("Raw balances data:", JSON.stringify(balances));
    }
    
    // Set up chart years filter
    const chartYearFilter = document.getElementById('chart-year-filter');
    if (chartYearFilter && balances.length > 0) {
      // Extract years from balances
      const years = [...new Set(balances.map(b => b.year || b.entry_year))];
      chartYearFilter.innerHTML = '';
      
      years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        chartYearFilter.appendChild(option);
      });
      
      chartYearFilter.addEventListener('change', (e) => {
        loadMonthlyBalances(e.target.value);
      });
    }
    
    try {
      // Create chart
      if (window.monthlyChart) {
        window.monthlyChart.destroy();
      }
      
      window.monthlyChart = new Chart(chartCanvas, {
        type: 'bar',
        data: {
          labels: months,
          datasets: [
            {
              label: 'Monthly Activity',
              data: monthlyData,
              backgroundColor: 'rgba(13, 110, 253, 0.5)',
              borderColor: 'rgba(13, 110, 253, 1)',
              borderWidth: 1
            },
            {
              label: 'End-of-Month Balance',
              data: balanceData,
              type: 'line',
              fill: false,
              borderColor: 'rgba(25, 135, 84, 1)',
              tension: 0.1,
              pointBackgroundColor: 'rgba(25, 135, 84, 1)'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: false
            }
          }
        }
      });
      console.log("Chart successfully created");
    } catch (error) {
      console.error("Error creating chart:", error);
      chartCanvas.parentElement.innerHTML = `<div class="text-center py-3 text-danger">Error creating chart: ${error.message}</div>`;
    }
  }

  // Set up form controls for the account detail page
  function setupFormControls(account) {
    // Date filters for entries
    const fromDateInput = document.getElementById('from-date');
    const toDateInput = document.getElementById('to-date');
    const filterButton = document.getElementById('filter-entries');
    
    if (filterButton) {
      filterButton.addEventListener('click', () => {
        loadAccountEntries(
          account.agreement_number,
          account.account_number,
          1,
          state.entries.limit,
          fromDateInput.value || null,
          toDateInput.value || null
        );
      });
    }
  }

  // Load account entries page
  async function loadAccountEntriesPage(page) {
    if (!state.currentAccount) return;
    
    const data = await fetchAccountEntries(
      state.currentAccount.agreement_number,
      state.currentAccount.account_number,
      page,
      state.entries.limit,
      state.entries.fromDate,
      state.entries.toDate
    );
    
    renderEntriesTable(data);
  }

  // Load account invoices page
  async function loadAccountInvoicesPage(page) {
    if (!state.currentAccount) return;
    
    const data = await fetchAccountInvoices(
      state.currentAccount.agreement_number,
      state.currentAccount.account_number,
      page,
      state.invoices.limit
    );
    
    renderInvoicesTable(data);
  }

  // Load monthly balances for a year
  async function loadMonthlyBalances(year) {
    if (!state.currentAccount) return;
    
    const data = await fetchMonthlyBalances(
      state.currentAccount.agreement_number,
      state.currentAccount.account_number,
      year
    );
    
    renderMonthlyChart(data.balances);
  }

  // Route handlers
  async function showAccountsList() {
    const accounts = await fetchAccounts();
    renderAccountsList(accounts);
  }

  async function showAccountDetails(params) {
    const { agreement_number, account_number } = params;
    
    // Show loading state
    document.getElementById('app').innerHTML = `
      <div class="text-center py-5">
        <div class="spinner-border" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>
    `;
    
    try {
      // Fetch account data
      const account = await fetchAccountByNumber(agreement_number, account_number);
      if (!account) {
        document.getElementById('app').innerHTML = `
          <div class="alert alert-danger" role="alert">
            Account not found. <a href="/accounts" class="alert-link">Go back to account list</a>.
          </div>
        `;
        return;
      }
      
      console.log("Account data loaded:", account);
      
      // Fetch related data
      const entriesPromise = fetchAccountEntries(agreement_number, account_number);
      const invoicesPromise = fetchAccountInvoices(agreement_number, account_number);
      const monthlyPromise = fetchMonthlyBalances(agreement_number, account_number);
      
      // Wait for all data to load
      const [entriesData, invoicesData, monthlyData] = await Promise.all([
        entriesPromise, invoicesPromise, monthlyPromise
      ]);
      
      console.log("All data loaded");
      
      // Render account details
      renderAccountDetails(account, entriesData, invoicesData, monthlyData.balances);
    } catch (error) {
      console.error("Error loading account details:", error);
      document.getElementById('app').innerHTML = `
        <div class="alert alert-danger" role="alert">
          Error loading account details: ${error.message}. <a href="/accounts" class="alert-link">Go back to account list</a>.
        </div>
      `;
    }
  }

  // Simple router implementation
  function router() {
    let url = window.location.pathname;
    
    // Find matching route
    for (const path in routes) {
      const routeParts = path.split('/');
      const urlParts = url.split('/');
      
      if (routeParts.length !== urlParts.length) {
        continue;
      }
      
      const params = {};
      let match = true;
      
      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          // This is a parameter
          const paramName = routeParts[i].substring(1);
          params[paramName] = urlParts[i];
        } else if (routeParts[i] !== urlParts[i]) {
          match = false;
          break;
        }
      }
      
      if (match) {
        routes[path](params);
        return;
      }
    }
    
    // No route matched, show 404
    document.getElementById('app').innerHTML = `
      <div class="alert alert-danger" role="alert">
        Page not found. <a href="/accounts" class="alert-link">Go back to account list</a>.
      </div>
    `;
  }
  
  // Make sure router runs
  window.addEventListener('load', () => {
    console.log("Window loaded - running router");
    if (typeof router === 'function') {
      router();
    } else {
      console.error("Router function not defined!");
    }
  });
  
  // Make the functions globally available for debugging
  window.showAccountDetails = showAccountDetails;
  window.renderMonthlyChart = renderMonthlyChart;
  window.renderEntriesTable = renderEntriesTable;
  window.renderInvoicesTable = renderInvoicesTable;
  
  // Initialize the app
  console.log("Initializing router");
  router();
}); 