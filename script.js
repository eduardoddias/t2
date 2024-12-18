let FFLConfigs = {
    storefrontApiToken: null,
    checkoutId: null,
    isGuestUser: true,
    preventSubmition: false,
    preventSubmitionMessage: 'Please complete the FFL selection.',
    isEnhancedCheckoutEnabled: false,
    statesRequireAmmoFFL: [],
    ammoOnlyRequireFFLMessage: 'You have selected a state where ammunition must be shipped to an FFL holder.',
    ammoOnlyAddressChangedMessage: 'The shipping address has been updated. Please update the FFL holder.',
    ammoOnlyNoAddressRequiredMessage: 'The selected ammunition products do not require shipping to an FFL holder and will be sent to your provided shipping address.',
    ammoRequireFFL: false,
    ammoRequireFFLMessage: 'Your ammunition products will be shipped to this FFL holder due to the requirements of the selected state.',
    ammoNeedsShipping: false, //TODO RENAME
    selectedDealer: null,
    hasNonFFLProducts: false,
    storeHash: null,
    shippingAddressAlreadyExists: false,
    platform: 'BigCommerce',
    automaticFFLStoreInfoEndpointUrl: 'https://app-stage.automaticffl.com/store-front/api/stores/',
    automaticFFLIframeUrl: 'https://needlessly-classic-jennet.ngrok-free.app',
    previousAmmoShippingToDealer: null
}

let filteredProducts = {
    fireArm: [],
    ammo: []
};

const htmlTemplates = {
    fflStep: `<div class="checkout-view-header">
            <div class="stepHeader is-readonly">
                <div class="stepHeader-figure stepHeader-column">
                  <div class="icon stepHeader-counter optimizedCheckout-step">
                      <svg height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path>
                      </svg>
                  </div>
                  <h2 class="stepHeader-title optimizedCheckout-headingPrimary" id="shipping-ffl">Shipping FFL</h2>
                </div>
            </div>
          </div>
          <div aria-busy="false" class="checkout-view-content checkout-view-content-enter-done">
            <section class="ffl-section checkout-form" style="">
                <div>
                  <div id="ffl-alert" class="alertBox alertBox--error alertBox--font-color-black">
                      %items%
                      %fflInfo%
                  </div>
                  <div class="form-action"><button type="button" class="button button--primary optimizedCheckout-buttonPrimary" id="ffl-select-dealer" onclick="toggleFFLDealerModal(true)">SELECT YOUR DEALER (FFL)</button></div>
                </div>
            </section>
          </div>`,
    fflInfo: `<div id="ffl-info" class="alertBox-column alertBox-message">
        <p>You have purchased an item that must be shipped to a Federal Firearms License holder (FFL).</p>
        <p>Before making a selection, contact the FFL and verify that they can accept your shipment prior to completing your purchase.</p>
      </div>`,
    fflItems: `<li>
        <div class="consignment ffl-item ffl-%product_type%" style="display: none">
            %product_image%
            <div class="consignment-product-body">
              <h5 class="optimizedCheckout-contentPrimary">%product_qty% x %product_name%</h5>
            </div>
        </div>
      </li>`,
    fflMessage: `<div id="ffl-message" class="modal-background"></div>
        <div id="ffl-message-alert-modal" class="modal modal--alert modal--small" tabindex="0">
            <div class="modal-alert-icon"><img src="${FFLConfigs.automaticFFLIframeUrl}/bigcommerce-alert-icon.svg" alt=""/></div>
            <div class="modal-content"></div>
            <div class="button-container">
                <button type="button" class="confirm button" onclick="hideMessage()">OK</button>
        </div>
        <div class="loadingOverlay" style="display: none;"></div>
    </div>`,
    fflModal: `<div class="ffl-checkout-locator-container locator-modal" style="display: initial;">
        <iframe src="%url%" style="width: 100%; height: 100%; border: none;"></iframe>
    </div>`
};

const graphqlPayloads = {
    userInformationQuery: `
      query {
        customer {
          entityId
        }
      }
    `,
    siteSettingsQuery: `
      query {
        site {
          settings {
            storeHash
          }
        }
      }
    `,
    cartProductsQuery: `
      query {
        site {
          cart {
            lineItems {
              physicalItems {
                entityId
                productEntityId
                quantity
                name
                image {
                  url(width: 120)
                }
              }
              digitalItems {
                entityId
                productEntityId
                quantity
                name
                image {
                  url(width: 120)
                }
              }
              giftCertificates {
                entityId
              }
              customItems {
                entityId
              }
            }
          }
        }
      }
    `,
    productDetailsQuery: `
      query {
        site {
          products(entityIds: [%product_ids%]) {
            edges {
              node {
                id
                entityId
                customFields {
                  edges {
                    node {
                      name
                      value
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    shippingConsignmentsQuery: `
      query {
        site {
          checkout {
            shippingConsignments {
              address {
                address1
                city
                stateOrProvinceCode
                postalCode
                phone
                countryCode
              }
            }
          }
        }
      }
    `,
    shippingConsignmentsMutation: `
      mutation addCheckoutShippingConsignments($addCheckoutShippingConsignmentsInput: AddCheckoutShippingConsignmentsInput!) {
        checkout {
          addCheckoutShippingConsignments(input: $addCheckoutShippingConsignmentsInput) {
            checkout {
              entityId
              shippingConsignments {
                entityId
                availableShippingOptions {
                  entityId
                }
                selectedShippingOption {
                  entityId
                }
              }
            }
          }
        }
      }
    `
};

async function fetchGraphQLData(query, variables = {}) {
    try {
        const response = await fetch('/graphql', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${FFLConfigs.storefrontApiToken}`
            },
            body: JSON.stringify({query, variables})
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        return data.data;
    } catch (error) {
        console.error("FFL Shipment: Failed to fetch GraphQL data:", error);
        return null;
    }
}

/**
 * TODO: get the correct config from task FRM-251 instead with_ammo_subscription
 **/
async function initFFLConfigs() {
    FFLConfigs.storeHash = await getStoreHash();
    const url = FFLConfigs.automaticFFLStoreInfoEndpointUrl + FFLConfigs.storeHash;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        FFLConfigs.isEnhancedCheckoutEnabled = data.with_ammo_subscription ?? false;
        FFLConfigs.statesRequireAmmoFFL = data.ammo_states ?? ['AK', 'CA', 'CT', 'DC', 'HI', 'IL', 'MA', 'NY'];
    } catch (error) {
        console.error("FFL Shipment: Failed to fetch data:", error);
    }
}

async function getUrlParams() {
    const scriptElement = document.currentScript || (function () {
        const scripts = document.getElementsByTagName('script');
        return scripts[scripts.length - 1];
    })();

    const urlParams = new URLSearchParams(new URL(scriptElement.src).search);

    FFLConfigs.storefrontApiToken = urlParams.get('token');
    FFLConfigs.checkoutId = urlParams.get('checkout_id');

    if (!FFLConfigs.storefrontApiToken || !FFLConfigs.checkoutId) {
        console.error("FFL Shipment: Missing script params");
    }
}

async function checkIfGuestUser() {
    if (filteredProducts.fireArm.length === 0) {
        return;
    }
    const data = await fetchGraphQLData(graphqlPayloads.userInformationQuery);
    FFLConfigs.isGuestUser = !data.customer?.entityId;

    if (!FFLConfigs.selectedDealer) {
        backToCustomerCheckoutStep();
    } /**else {
        let shippingConsignments = await getShippingConsignments();
        if (!FFLConfigs.isGuestUser && (filteredProducts.fireArm.length === 0 || shippingConsignments)) {
            showFFLAmmoOnlyHandler(shippingConsignments);
        }
    }*/
}

async function getStoreHash() {
    const data = await fetchGraphQLData(graphqlPayloads.siteSettingsQuery);
    return data.site.settings.storeHash || null;
}

async function getCartProducts() {
    const data = await fetchGraphQLData(graphqlPayloads.cartProductsQuery);

    if (!data) return null;

    const physicalItems = data.site.cart.lineItems.physicalItems || [];
    const digitalItems = data.site.cart.lineItems.digitalItems || [];
    const giftCertificates = data.site.cart.lineItems.giftCertificates || [];
    const customItems = data.site.cart.lineItems.customItems || [];

    if (giftCertificates.length > 0 || customItems.length > 0) {
        FFLConfigs.hasNonFFLProducts = true;
    }

    return [...physicalItems, ...digitalItems];
}

async function getProductDetailsByIds(productIds) {
    const query = graphqlPayloads.productDetailsQuery.replace('%product_ids%', productIds);
    const data = await fetchGraphQLData(query);

    if (!data) return null;

    return data.site.products.edges.map(edge => edge.node);
}

async function getShippingConsignments() {
    const data = await fetchGraphQLData(graphqlPayloads.shippingConsignmentsQuery);
    return data?.site.checkout.shippingConsignments[0]?.address || null;
}

async function setShippingConsignments(dealerData) {
    const lineItems = [];

    filteredProducts.fireArm.forEach(product => {
        lineItems.push({
            lineItemEntityId: product.entityId,
            quantity: product.quantity
        });
    });

    filteredProducts.ammo.forEach(product => {
        lineItems.push({
            lineItemEntityId: product.entityId,
            quantity: product.quantity
        });
    });

    const variables = {
        addCheckoutShippingConsignmentsInput: {
            checkoutEntityId: FFLConfigs.checkoutId,
            data: {
                consignments: [
                    {
                        address: {
                            firstName: "",
                            lastName: "",
                            company: dealerData.company,
                            address1: dealerData.address1,
                            city: dealerData.city,
                            stateOrProvince: dealerData.stateOrProvinceCode,
                            stateOrProvinceCode: dealerData.stateOrProvinceCode,
                            postalCode: dealerData.postalCode,
                            phone: dealerData.phone,
                            countryCode: dealerData.countryCode,
                            shouldSaveAddress: false
                        },
                        lineItems: lineItems
                    }
                ]
            }
        }
    };

    await fetchGraphQLData(graphqlPayloads.shippingConsignmentsMutation, variables);
}

async function initFFLProducts() {
    await getUrlParams()
    const products = await getCartProducts();
    if (!products || products.length === 0) {
        console.log("FFL Shipment: No product IDs found in the cart.");
        return;
    }

    const productIds = products.map(product => product.productEntityId);
    const productDetails = await getProductDetailsByIds(productIds);
    if (!productDetails) {
        console.log("FFL Shipment: Failed to retrieve product details.");
        return;
    }

    productDetails.forEach(productDetail => {
        const fflTypeField = productDetail.customFields.edges.find(field => field.node.name.toLowerCase() === 'ffl_type');
        const fflField = productDetail.customFields.edges.find(field => field.node.name.toLowerCase() === 'ffl');
        let fullProductData = null;

        if (fflTypeField || fflField) {
            const matchedProduct = products.find(prod => prod.productEntityId === productDetail.entityId);
            fullProductData = {...matchedProduct, ffl_type: fflTypeField ? fflTypeField.node.value.toLowerCase() : 'firearm'};
        }
        if (fflTypeField && fflTypeField.node.value.toLowerCase() === 'firearm') {
            filteredProducts.fireArm.push(fullProductData);
            return;
        } else if (fflTypeField && fflTypeField.node.value.toLowerCase() === 'ammo') {
            filteredProducts.ammo.push(fullProductData);
            return;
        } else if (fflField && fflField.node.value.toLowerCase() === 'yes') {
            filteredProducts.fireArm.push(fullProductData);
            return;
        }
        FFLConfigs.hasNonFFLProducts = true;
    });
}

async function addFFLCheckoutStep() {
    const checkoutSteps = document.querySelector('.checkout-steps');
    if (!checkoutSteps) {
        console.error("FFL Shipment: Checkout steps container not found.");
        return;
    }

    const itemsHTML = [...filteredProducts.fireArm, ...filteredProducts.ammo].map(product => {
        return htmlTemplates.fflItems
            .replace('%product_type%', product.ffl_type)
            .replace(
                '%product_image%',
                product.image?.url ? `<figure class="consignment-product-figure"><img alt="${product.name}" src="${product.image?.url}"></figure>` : '<div class="consignment-product-figure"></div>',
            )
            .replace('%product_qty%', product.quantity)
            .replace(/%product_name%/g, product.name);
    }).join('');

    let fflTemplate = htmlTemplates.fflStep.replace('%items%', itemsHTML)
        .replace('%fflInfo%', htmlTemplates.fflInfo);
    fflTemplate += htmlTemplates.fflModal.replace('%url%', `${FFLConfigs.automaticFFLIframeUrl}?store_hash=${FFLConfigs.storeHash}&platform=${FFLConfigs.platform}`);
    const wrapperElement = document.createElement('li');
    wrapperElement.classList.add('checkout-step', 'optimizedCheckout-checkoutStep', 'checkout-step--shipping-ffl', 'ffl-items');
    wrapperElement.style.display = 'none';
    wrapperElement.innerHTML = fflTemplate;
    document.body.insertAdjacentHTML('beforeend', htmlTemplates.fflMessage);

    checkoutSteps.insertBefore(wrapperElement, checkoutSteps.firstChild);
    if (filteredProducts.fireArm.length > 0) {
        setFFLVisibility('firearm');
    }
}

async function showFFLAmmoOnlyHandler(shippingConsignments) {
    const state = shippingConsignments?.stateOrProvinceCode;
    const isSameAddress = isDealerAndShippingAddressSame(shippingConsignments)
    const hasAmmo = filteredProducts.ammo.length > 0;
    const ammoOnly = filteredProducts.fireArm.length === 0 && filteredProducts.ammo.length > 0 && !FFLConfigs.hasNonFFLProducts;
    const stateRequiresFFL = FFLConfigs.statesRequireAmmoFFL.includes(state)
    // SE TIVER AMMO
    // SE NAO TIVER AMMO
    // SE ENDERECO MUDOU E PRECISA DO AMMO
    // SE ENDERECO MUDOU E NAO PRECISA MAIS DO AMMO

    if (hasAmmo && state && stateRequiresFFL) {// ammo precisa
        setFFLVisibility('ammo');
        if (!FFLConfigs.selectedDealer) {
            showMessage(FFLConfigs.ammoOnlyRequireFFLMessage);
        } else if(!isSameAddress && ammoOnly) { // endereco mudou
            FFLConfigs.selectedDealer = false;
            const fflAlert = document.querySelector('#ffl-alert');
            fflAlert.classList.remove('alertBox--success');
            fflAlert.classList.add('alertBox--error');
            document.querySelector('#ffl-info').innerHTML = htmlTemplates.fflInfo;
            showMessage(FFLConfigs.ammoOnlyAddressChangedMessage);
            FFLConfigs.ammoNeedsShipping = true;
            // FFLConfigs.ammoNeedsShipping = true;
        } else if (!ammoOnly) {
            FFLConfigs.ammoNeedsShipping = true;
            // FFLConfigs.ammoNeedsShipping = false;
            showMessage(FFLConfigs.ammoRequireFFLMessage) //TODO
        }
    } else if (hasAmmo && !isSameAddress && FFLConfigs.previousAmmoShippingToDealer && FFLConfigs.previousAmmoShippingToDealer !== state) {
        FFLConfigs.ammoNeedsShipping = false;
        setFFLVisibility('ammo', 'none');
        showMessage(FFLConfigs.ammoOnlyNoAddressRequiredMessage);
    } else if (!isSameAddress) {// ammo nao precisa
        setFFLVisibility('ammo', 'none');
    }
    FFLConfigs.previousAddressState = stateRequiresFFL ? state : null;
    setAddressReferenceAlertVisibility();

    // if ((state && FFLConfigs.statesRequireAmmoFFL.includes(state)) || FFLConfigs.selectedDealer) {
    //
    // }

    // if ((state && FFLConfigs.statesRequireAmmoFFL.includes(state)) || FFLConfigs.selectedDealer) {
    //     setFFLVisibility('ammo');
    //     if (!FFLConfigs.selectedDealer) {
    //         showMessage(FFLConfigs.ammoOnlyRequireFFLMessage);
    //     } else if(!isSameAddress) {
    //         const isStateRequired = FFLConfigs.statesRequireAmmoFFL.includes(state)
    //         if (isStateRequired && filteredProducts.fireArm.length === 0) {
    //             FFLConfigs.selectedDealer = false;
    //             const fflAlert = document.querySelector('#ffl-alert');
    //             fflAlert.classList.remove('alertBox--success');
    //             fflAlert.classList.add('alertBox--error');
    //             document.querySelector('#ffl-info').innerHTML = htmlTemplates.fflInfo;
    //             showMessage(FFLConfigs.ammoOnlyAddressChangedMessage);
    //         } else if (!isStateRequired) {
    //             setFFLVisibility('ammo', 'none');
    //             setAddressReferenceAlertVisibility();
    //             showMessage(FFLConfigs.ammoOnlyNoAddressRequiredMessage);
    //             // FFLConfigs.selectedDealer = false;
    //         }
    //     } else if (FFLConfigs.ammoNeedsShipping && FFLConfigs.statesRequireAmmoFFL.includes(state)) {
    //         FFLConfigs.ammoNeedsShipping = false;
    //         showMessage(FFLConfigs.ammoRequireFFLMessage) //TODO
    //     }
    //     backToCustomerCheckoutStep();
    //     FFLConfigs.shippingAddressAlreadyExists = true;
    //     return;
    // }
    // if(!isSameAddress) {
    //     setFFLVisibility('ammo', 'none');
    // }
}

function isDealerAndShippingAddressSame(shippingAddress) {
    let dealerData = FFLConfigs.selectedDealer;
    if (!shippingAddress || !dealerData) return false;

    return shippingAddress.address1 === dealerData.address1 &&
        shippingAddress.city === dealerData.city &&
        shippingAddress.stateOrProvinceCode === dealerData.stateOrProvinceCode &&
        shippingAddress.postalCode === dealerData.postalCode &&
        shippingAddress.phone === dealerData.phone &&
        shippingAddress.countryCode === dealerData.countryCode;
}

function setFFLVisibility(productType, display = 'flex') {
    const fflItemsElement = document.querySelector('.ffl-items');
    if (filteredProducts.fireArm.length === 0 && productType === 'ammo' && display === 'none') {
        FFLConfigs.preventSubmition = false;
        FFLConfigs.ammoRequireFFL = false;
        fflItemsElement.style.display = 'none';
        return;
    }
    if (productType === 'ammo') {
        FFLConfigs.ammoRequireFFL = display === 'flex';
    }
    FFLConfigs.preventSubmition = true;
    fflItemsElement.style.display = 'block';
    document.querySelectorAll(`.ffl-item.ffl-${productType}`).forEach(function (element) {
        element.style.display = display;
    });
}

function setAddressReferenceAlertVisibility() {
    const display = !FFLConfigs.hasNonFFLProducts &&
    (filteredProducts.ammo.length === 0 || FFLConfigs.ammoRequireFFL) ? 'block' : 'none';

    addStyle(`.checkout-step--shipping .checkout-form::before {
        display: ${display}}
    }`)
}

function toggleFFLDealerModal(forceBackToCustomerCheckoutStep = false) {
    if (forceBackToCustomerCheckoutStep && FFLConfigs.isGuestUser && !FFLConfigs.hasNonFFLProducts) {
        backToCustomerCheckoutStep();
    }
    document.querySelector('.ffl-checkout-locator-container').classList.toggle('show-locator');
}

async function handleDealerUpdate(event) {
    if (event?.data?.type === 'dealerUpdate') {
        FFLConfigs.selectedDealer = event.data.value;
        document.querySelector('#ffl-info').innerHTML = `<p>${event.data.value.addressFormatted}</p>`;

        FFLConfigs.ammoNeedsShipping = true;

        if (shouldSetShippingConsignments()) {
            await setShippingConsignments(event.data.value);
            backToShippingCheckoutStep();
        } else if (filteredProducts.ammo.length > 0) {
            let shippingConsignments = await getShippingConsignments();
            const state = shippingConsignments?.stateOrProvinceCode;

            if (FFLConfigs.statesRequireAmmoFFL.includes(state)) {
                setFFLVisibility('ammo');
                if (filteredProducts.fireArm.length > 0) {
                    showMessage(FFLConfigs.ammoRequireFFLMessage);
                }
            }
        }

        // if (FFLConfigs.statesRequireAmmoFFL.includes(event.data.value.stateOrProvinceCode) && filteredProducts.ammo.length > 0) {
        //     setFFLVisibility('ammo');
        //     if (filteredProducts.fireArm.length > 0) {
        //         showMessage(FFLConfigs.ammoRequireFFLMessage);
        //         FFLConfigs.ammoNeedsShipping = true;
        //     }
        // } else if (filteredProducts.fireArm.length > 0) {
        //     const shippingConsignments = await getShippingConsignments();
        //     const state = shippingConsignments?.stateOrProvinceCode
        //     if (!state || (state && !FFLConfigs.statesRequireAmmoFFL.includes(state))) {
        //         setFFLVisibility('ammo', 'none');
        //         if (FFLConfigs.ammoNeedsShipping) {
        //             showMessage(FFLConfigs.ammoOnlyNoAddressRequiredMessage);
        //             FFLConfigs.ammoNeedsShipping = false;
        //         }
        //     }
        // }
        setAddressReferenceAlertVisibility()

        const fflAlert = document.querySelector('#ffl-alert');
        fflAlert.classList.add('alertBox--success');
        fflAlert.classList.remove('alertBox--error');

        document.querySelector('#ffl-select-dealer').innerText = 'CHANGE DEALER (FFL)';

        toggleFFLDealerModal();
    } else if (event?.data?.type === 'closeModal') {
        toggleFFLDealerModal();
    }
}

async function handleAmmoOnlyProducts() {
    let shippingConsignments = await getShippingConsignments();
    const noFireArmItems = filteredProducts.fireArm.length === 0;

    // se logado (nao tiver arma ou tiver shipping)
    // se deslogado e nao tiver armar

    if ((FFLConfigs.isGuestUser && noFireArmItems && shippingConsignments) ||
        (!FFLConfigs.isGuestUser && (noFireArmItems || shippingConsignments))) {
        showFFLAmmoOnlyHandler(shippingConsignments);
    }

    let eventAdded = false;
    const observer = new MutationObserver(() => {
        const element = document.querySelector("#checkout-shipping-continue");
        if (element && !eventAdded) {
            element.addEventListener('click', async () => {
                shippingConsignments = await getShippingConsignments();
                showFFLAmmoOnlyHandler(shippingConsignments);
                setTimeout(() => {
                    eventAdded = false;
                }, 1000);
            });
            eventAdded = true;
        }
    });

    const targetNode = await waitForElement('.checkout-step--shipping');
    observer.observe(targetNode, { childList: true, subtree: true, attributes: true });
}

async function preventGuestUserSubmissionOnLogin() {
    const observer = new MutationObserver(() => {
        if (!FFLConfigs.isGuestUser) {
            return;
        }

        const element = document.querySelector("#checkout-customer-continue");
        if (element) {
            element.addEventListener('click', (event) => {
                const passwordInput = document.querySelector('.checkout-step--customer #password');
                if (passwordInput && passwordInput.offsetParent !== null) {
                    return;
                }

                if (FFLConfigs.preventSubmition && !FFLConfigs.selectedDealer) {
                    event.preventDefault();
                    showMessage(FFLConfigs.preventSubmitionMessage);
                } else {
                    setAddressData();
                }
            });
        }
    });

    const targetNode = await waitForElement('.checkout-step--customer');
    observer.observe(targetNode, { childList: true, subtree: true, attributes: true });
}

async function preventSubmissionOnPayment() {
    const observer = new MutationObserver(() => {
        const element = document.querySelector("#checkout-payment-continue");
        if (element && !element.dataset.preventSubmissionEvent) {
            element.addEventListener('click', (event) => {
                if (FFLConfigs.preventSubmition && !FFLConfigs.selectedDealer) {
                    event.preventDefault();
                    showMessage(FFLConfigs.preventSubmitionMessage);
                }
            });
            element.dataset.preventSubmissionEvent = "true";
        }
    });

    const targetNode = await waitForElement('.checkout-step--payment');
    observer.observe(targetNode, { childList: true, subtree: true, attributes: true });
}
function backToCustomerCheckoutStep() {
    if (FFLConfigs.shippingAddressAlreadyExists) {
        return;
    }
    const customerSelector = document.querySelector('.checkout-step--customer .stepHeader-actions button');
    if (FFLConfigs.isGuestUser && customerSelector) {
        // if (FFLConfigs.preventSubmition && !FFLConfigs.selectedDealer) {
        //     showMessage(FFLConfigs.preventSubmitionMessage+"3");
        // }
        customerSelector.click();
    }
}

function backToShippingCheckoutStep() {
    const shippingSelector = document.querySelector('.checkout-step--shipping .stepHeader-actions button');
    if (shippingSelector) {
        shippingSelector.click();
    }
}

async function setAddressData() {
    const observer = new MutationObserver(() => {
        const province = document.querySelector('.checkout-step--shipping #provinceCodeInput');
        if (province && !province.value) {
            province.value = FFLConfigs.selectedDealer.stateOrProvinceCode;
            province.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }

        const sameAsBilling = document.querySelector('.checkout-step--shipping #sameAsBilling');
        if (sameAsBilling) {
            if (sameAsBilling.checked) {
                setTimeout(() => {
                    sameAsBilling.click();
                }, 500);
            }
        }
        if (province && sameAsBilling) {
            observer.disconnect();
        }
    });

    const targetNode = await waitForElement('.checkout-step--shipping');
    observer.observe(targetNode, { childList: true, subtree: true, attributes: true });
}

function shouldSetShippingConsignments() {
    setAddressReferenceAlertVisibility();
    return FFLConfigs.isGuestUser && !FFLConfigs.hasNonFFLProducts
        // &&
        // (filteredProducts.ammo.length === 0 || FFLConfigs.ammoRequireFFL)
}

function showMessage(message) {
    setTimeout(() => {
        document.getElementById("shipping-ffl").scrollIntoView();
    }, 1000);

    const alertBox = document.querySelector('#ffl-message');
    const alertBoxMessage = document.querySelector('#ffl-message-alert-modal');
    const alertBoxMessageContent = document.querySelector('#ffl-message-alert-modal .modal-content');
    Object.assign(alertBox.style, {display: 'block', opacity: '0.8'});
    Object.assign(alertBoxMessage.style, {display: 'block', opacity: '1'});

    alertBoxMessageContent.innerText = message;
}

function hideMessage() {
    const alertBox = document.querySelector('#ffl-message');
    const alertBoxMessage = document.querySelector('#ffl-message-alert-modal');

    Object.assign(alertBox.style, {display: 'none', opacity: '0'});
    Object.assign(alertBoxMessage.style, {display: 'none', opacity: '0'});
}

function preventScroll() {
    setTimeout(() => {
        window.scrollTo(0, 0);
        let preventScroll = true;
        window.addEventListener('scroll', (e) => {
            if (preventScroll) {
                window.scrollTo(0, 0);
                const loadingElement = document.querySelector('.loadingNotification');
                if (!loadingElement || loadingElement && loadingElement.offsetParent == null) {
                    setTimeout(() => {
                        preventScroll = false;
                    }, 500);
                }
            }
        }, { once: false });
    }, 100);
}

function addFFLStyle() {
    addStyle(`.ffl-section .alertBox--font-color-black {
          color: #000;
          border-radius: 3px;
      }
      .consignment {
          display: flex;
          flex-direction: row;
          margin: .75rem 0 1.5rem;
          width: 100%;
      }
      .consignment-product-figure {
          padding: 0 1.5rem 0;
          width: 25%;
      }
      .consignment-product-body {
          display: flex;
          flex-direction: column;
          width: 100%;
      }
      .consignment-product-body h5 {
          margin-bottom: .1875rem;
      }
      .locator-modal {
          background-color: #eee;
          color: gray;
          display: grid;
          font-family: Arial, sans-serif;
          grid-gap: 1px;
          grid-template-areas:
              "header header header header"
              "content map map map";
          grid-template-columns: 1fr 1fr 1fr 1fr;
          grid-template-rows: 1fr 10fr;
          height: 100%;
          position: fixed;
          right: 0;
          top: 0;
          transform: translateX(100%);
          transition: transform .25s, visibility .25s;
          visibility: hidden;
          width: 100%;
          z-index: 100000000;
      }
      .locator-modal.show-locator {
          transform: translateX(0%);
          transition: transform .25s;
          visibility: visible;
      }
      #ffl-message {
         display: none;
         background-color: black;
      }
      #ffl-message-alert-modal {
         @media (min-width: 600px) {
             width: 470px;
         }
         display: none;
         visibility: visible;
         padding: 20px 20px 0 20px;
         text-align: center;
      }
      #ffl-message-alert-modal .modal-content {
        padding-bottom: 20px;
      }
      #ffl-message-alert-modal .modal-alert-icon {
        width: 76px;
        height: 76px;
        margin: 1.25em auto 1.875em;
      }
      .checkout-step--shipping .checkout-form::before {
        display: none;
        background-color: #feffd7;
        padding: 13px 20px;
        width: 100%;
        content: 'This shipping address is for reference only. All items will be shipped directly to the designated FFL dealer.';
        margin-bottom: 15px;
        border-radius: 3px;
      }`);
}

async function handleLoginOrLogout() {
    await checkIfGuestUser();
    const targetNode = await waitForElement('.checkout-step.optimizedCheckout-checkoutStep.checkout-step--customer');
    const observer = new MutationObserver(() => checkIfGuestUser());
    observer.observe(targetNode, {childList: true});
}

async function waitForElement(selector) {
    while (!document.querySelector(selector)) {
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return document.querySelector(selector);
}

function addStyle(styleString) {
    const style = document.createElement('style');
    style.textContent = styleString;
    document.head.append(style);
}

(async () => {
    preventScroll();
    await initFFLProducts();
    if (filteredProducts.fireArm.length === 0 && filteredProducts.ammo.length === 0) {
        console.log("FFL Shipment: No FFL products in the cart.");
        return;
    }
    await initFFLConfigs();
    if (!FFLConfigs.isEnhancedCheckoutEnabled) {
        console.log("FFL Shipment: FFL is disabled.");
        return;
    }

    await handleLoginOrLogout();
    preventGuestUserSubmissionOnLogin();
    preventSubmissionOnPayment();
    addFFLStyle();
    await addFFLCheckoutStep();

    // if (filteredProducts.fireArm.length === 0) {
        handleAmmoOnlyProducts();
    // }
    window.addEventListener('message', handleDealerUpdate);
})();
