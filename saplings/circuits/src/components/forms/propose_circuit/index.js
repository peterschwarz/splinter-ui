/**
 * Copyright 2018-2020 Cargill Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { getUser } from 'splinter-saplingjs';
import React, { useState, useEffect, useReducer } from 'react';
import yaml from 'js-yaml';
import { useToasts } from 'react-toast-notifications';
import { useHistory } from 'react-router-dom';

import { MultiStepForm, Step } from 'App/components/forms/MultiStepForm';
import { useNodeRegistryState } from 'App/state/nodeRegistry';
import { useLocalNodeState } from 'App/state/localNode';

import NodeCard from 'App/components/NodeCard';
import ProposalReview from 'App/components/ProposalReview';

import { OverlayModal } from 'App/components/OverlayModal';
import { NewNodeForm } from 'App/components/forms/NewNodeForm';

import { generateID } from 'App/data/circuits';
import protos from 'App/protobuf';
import { makeSignedPayload } from 'App/api/payload';
import { postCircuitManagementPayload } from 'App/api/splinter';
import { Chips } from 'App/components/Chips';
import { Button } from 'App/components/forms/controls';

import { ServiceTable, ServiceForm } from './service';

import './index.scss';

const generateCircuitID = () => {
  const firstPart = generateID(5);
  const secondPart = generateID(5);
  return `${firstPart}-${secondPart}`;
};

const filterNodes = state => {
  const { filteredBy } = state.filteredNodes;
  const lowerInput = filteredBy.toLowerCase();

  let selectionFilter = node =>
    !!state.selectedNodes.find(
      selectedNode => node.identity === selectedNode.identity
    );

  if (!state.showSelectedOnly) {
    const selectedFilter = selectionFilter;
    selectionFilter = node => !selectedFilter(node);
  }
  const nodes = state.availableNodes.filter(selectionFilter).filter(node => {
    if (node.identity.toLowerCase().indexOf(lowerInput) > -1) {
      return true;
    }
    if (node.displayName.toLowerCase().indexOf(lowerInput) > -1) {
      return true;
    }
    return false;
  });

  // Sort the nodes by identity, leaving the localNode at the top.
  nodes.sort((nodeA, nodeB) => {
    if (nodeA.identity === state.localNodeId) {
      return -1;
    }
    if (nodeB.identity === state.localNodeId) {
      return 1;
    }
    return nodeA.identity.localeCompare(nodeB.identity);
  });

  return { nodes, filteredBy };
};

const nodesReducer = (state, action) => {
  const minNodeCountError =
    'At least two nodes must be part of a circuit. Please select a node.';

  let intermediateState = state;
  switch (action.type) {
    case 'init': {
      const { localNode, nodes } = action;
      intermediateState = {
        selectedNodes: [localNode],
        localNodeId: localNode.identity,
        nodes,
        availableNodes: nodes,
        filteredNodes: {
          nodes: [],
          filteredBy: ''
        }
      };
      break;
    }
    case 'filter': {
      intermediateState = {
        ...state,
        filteredNodes: {
          nodes: [],
          filteredBy: action.input
        }
      };
      break;
    }
    case 'showSelectedOnly': {
      intermediateState = {
        ...state,
        showSelectedOnly: true
      };
      break;
    }
    case 'showAllNodes': {
      intermediateState = {
        ...state,
        showSelectedOnly: false
      };
      break;
    }
    case 'toggleSelect': {
      const { node } = action;

      const { selectedNodes } = state;
      const alreadySelected = selectedNodes.find(
        selectedNode => node.identity === selectedNode.identity
      );

      if (!alreadySelected) {
        selectedNodes.push(node);
      }
      intermediateState = { ...state, selectedNodes };
      break;
    }
    case 'removeSelect': {
      const { node } = action;
      const selectedNodes = state.selectedNodes.filter(
        item => item.identity !== node.identity
      );

      intermediateState = { ...state, selectedNodes };
      break;
    }
    case 'addNode': {
      const { node } = action;
      const { availableNodes } = state;
      availableNodes.push(node);

      intermediateState = { ...state, availableNodes };
      break;
    }
    default:
      throw new Error(`unhandled action type: ${action.type}`);
  }

  let { error } = state;
  if (intermediateState.selectedNodes.length >= 2) {
    error = '';
  } else {
    error = minNodeCountError;
  }

  return {
    ...intermediateState,
    error,
    filteredNodes: filterNodes(intermediateState)
  };
};

const servicesReducer = (state, [action, ...args]) => {
  switch (action) {
    case 'save': {
      const [service, oldService] = args;
      const { services } = state;

      if (oldService) {
        const serviceIndex = services.findIndex(
          svc => oldService.serviceId === svc.serviceId
        );

        if (serviceIndex > -1) {
          services[serviceIndex] = service;
        }
      } else {
        services.push(service);
      }

      return { ...state, services, editService: null };
    }
    case 'delete': {
      const [serviceId] = args;
      const { services } = state;

      const serviceIndex = services.findIndex(
        service => service.serviceId === serviceId
      );
      if (serviceIndex > -1) {
        services.splice(serviceIndex, 1);
      }

      return { ...state, services };
    }
    case 'edit': {
      const [serviceId] = args;

      const serviceIndex = state.services.findIndex(
        service => service.serviceId === serviceId
      );
      let editService = null;
      if (serviceIndex > -1) {
        editService = state.services[serviceIndex];
      }

      return { ...state, editService };
    }
    case 'cancel-edit': {
      return { ...state, editService: null };
    }
    default:
      throw new Error(`unhandled action type: ${action.type}`);
  }
};

const detailsReducer = (state, action) => {
  switch (action.type) {
    case 'set-management-type': {
      const { managementType } = action;
      const newState = state;
      newState.managementType = managementType;
      if (managementType.length === 0) {
        newState.errors.managementType = 'Management type cannot be empty';
      } else {
        newState.errors.managementType = '';
      }
      return { ...newState };
    }
    case 'set-comments': {
      const { comments } = action;
      const newState = state;
      newState.comments = comments;
      return { ...newState };
    }
    default:
      throw new Error(`unhandled action type: ${action.type}`);
  }
};

const isValidMetadata = (encoding, input) => {
  switch (encoding) {
    case 'json': {
      try {
        JSON.parse(input);
      } catch (e) {
        return false;
      }
      return true;
    }
    case 'yaml': {
      try {
        yaml.safeLoad(input);
      } catch (e) {
        return false;
      }
      return true;
    }
    case 'base64': {
      const regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
      if (input.match(regex)) {
        return true;
      }
      return false;
    }
    default:
      throw new Error(`invalid encoding type: ${encoding}`);
  }
};

const metadataReducer = (state, action) => {
  switch (action.type) {
    case 'set-encoding': {
      const { encoding } = action;
      const newState = state;
      newState.encoding = encoding;
      if (
        state.metadata.length !== 0 &&
        !isValidMetadata(encoding, state.metadata)
      ) {
        newState.error = `Metadata value is not valid ${state.encoding}`;
      } else {
        newState.error = '';
      }
      return { ...newState };
    }
    case 'set-metadata': {
      const { metadata } = action;
      const newState = state;
      newState.metadata = metadata;
      if (metadata.length !== 0 && !isValidMetadata(state.encoding, metadata)) {
        newState.error = `Metadata value is not valid ${state.encoding}`;
      } else {
        newState.error = '';
      }

      return { ...newState };
    }
    default:
      throw new Error(`unhandled action type: ${action.type}`);
  }
};

export function ProposeCircuitForm() {
  const allNodes = useNodeRegistryState();
  const { addToast } = useToasts();
  const history = useHistory();

  const localNodeID = useLocalNodeState();
  const [modalActive, setModalActive] = useState(false);
  const localNode = allNodes.find(node => node.identity === localNodeID);
  const [nodesState, nodesDispatcher] = useReducer(nodesReducer, {
    selectedNodes: [],
    availableNodes: [],
    showSelectedOnly: false,
    filteredNodes: {
      nodes: [],
      filteredBy: ''
    },
    error: ''
  });

  const [servicesState, servicesDispatcher] = useReducer(servicesReducer, {
    services: [],
    editService: null
  });

  const [detailsState, detailsDispatcher] = useReducer(detailsReducer, {
    managementType: '',
    comments: '',
    errors: {
      managementType: ''
    }
  });

  const [metadataState, metadataDispatcher] = useReducer(metadataReducer, {
    encoding: 'json',
    metadata: '',
    error: ''
  });

  const [serviceFormComplete, setServiceFormComplete] = useState(false);

  const nodesAreValid = () => {
    return nodesState.selectedNodes.length >= 2;
  };

  const detailsAreValid = () => {
    return (
      detailsState.errors.managementType.length === 0 &&
      detailsState.managementType.length > 0
    );
  };

  const metadataIsValid = () => {
    return metadataState.error.length === 0;
  };

  const handleSubmit = async () => {
    const nodes = nodesState.selectedNodes.map(node => {
      return protos.SplinterNode.create({
        nodeId: node.identity,
        endpoints: node.endpoints
      });
    });

    const services = servicesState.services.map(service => {
      return protos.SplinterService.create({
        serviceId: service.serviceId,
        serviceType: service.serviceType,
        allowedNodes: service.allowedNodes,
        arguments: Object.entries(service.arguments).map(([key, value]) => {
          return protos.SplinterService.Argument.create({
            key,
            value
          });
        })
      });
    });
    const circuitId = generateCircuitID();

    let metadata = null;
    if (metadataState.encoding === 'base64') {
      metadata = Buffer.from(metadataState.metadata, 'base64');
    } else {
      metadata = Buffer.from(metadataState.metadata, 'utf8');
    }

    const circuit = protos.Circuit.create({
      circuitId,
      roster: services,
      members: nodes,
      authorizationType: protos.Circuit.AuthorizationType.TRUST_AUTHORIZATION,
      persistence: protos.Circuit.PersistenceType.ANY_PERSISTENCE,
      durability: protos.Circuit.DurabilityType.NO_DURABILITY,
      routes: protos.Circuit.RouteType.ANY_ROUTE,
      circuitManagementType: detailsState.managementType,
      applicationMetadata: metadata,
      comments: detailsState.comments
    });
    const circuitCreateRequest = protos.CircuitCreateRequest.create({
      circuit
    });

    const { privateKey } = window.$CANOPY.getKeys();
    const user = getUser();

    try {
      const payload = makeSignedPayload(
        localNodeID,
        privateKey,
        circuitCreateRequest,
        'proposeCircuit'
      );
      try {
        await postCircuitManagementPayload(payload, user.token);
        addToast('Circuit proposal submitted successfully', {
          appearance: 'success'
        });
        history.push(`/circuits`);
      } catch (e) {
        addToast(`The splinter daemon responded with an error: ${e}`, {
          appearance: 'error'
        });
      }
    } catch (e) {
      addToast(`Failed to build the circuit management payload: ${e}`, {
        appearance: 'error'
      });
    }
  };

  useEffect(() => {
    if (localNode && allNodes) {
      nodesDispatcher({
        type: 'init',
        localNode,
        nodes: allNodes
      });
    }
  }, [localNode, allNodes]);

  useEffect(() => {
    let servicesAreValid = false;

    servicesState.services.forEach(service => {
      servicesAreValid =
        service.serviceType.length > 0 &&
        service.serviceId.length > 0 &&
        service.allowedNodes.length > 0;
    });
    if (servicesAreValid) {
      setServiceFormComplete(true);
    } else {
      setServiceFormComplete(false);
    }
  }, [servicesState]);

  const stepValidationFn = stemNumber => {
    switch (stemNumber) {
      case 1:
        return nodesAreValid();
      case 2:
        return serviceFormComplete;
      case 3:
        return detailsAreValid();
      case 4:
        return metadataIsValid();
      default:
        return true;
    }
  };

  const {
    showSelectedOnly,
    selectedNodes,
    filteredNodes,
    availableNodes
  } = nodesState;
  const remainingNodeCount = availableNodes.length - selectedNodes.length;

  let nodeCards;
  if (filteredNodes.nodes.length > 0) {
    nodeCards = filteredNodes.nodes.map(node => {
      const local = node.identity === localNodeID;
      const selected = !!selectedNodes.find(selectedNode => {
        return node.identity === selectedNode.identity;
      });
      return (
        <li key={node.identity} className="node-item">
          <NodeCard
            node={node}
            dispatcher={targetNode => {
              nodesDispatcher({
                type: 'toggleSelect',
                node: targetNode
              });
            }}
            isLocal={local}
            isSelected={selected}
          />
        </li>
      );
    });
  } else if (!showSelectedOnly && remainingNodeCount === 0) {
    nodeCards = (
      <li className="no-nodes">
        All available nodes have been selected for this circuit.
      </li>
    );
  } else if (showSelectedOnly && selectedNodes.length === 0) {
    nodeCards = (
      <li className="no-nodes">
        At least two nodes must be selected for this circuit.
      </li>
    );
  } else {
    nodeCards = (
      <li className="no-nodes">No nodes match your search criteria.</li>
    );
  }

  return (
    <MultiStepForm
      formName="Propose Circuit"
      handleSubmit={handleSubmit}
      handleCancel={() => history.push(`/circuits`)}
      isStepValidFn={stepNumber => stepValidationFn(stepNumber)}
    >
      <Step step={1} label="Select nodes">
        <div className="step-header">
          <div className="step-title">Select nodes</div>
          <div className="help-text">
            Select the nodes that are part of the circuit
          </div>
        </div>
        <div className="propose-form-wrapper node-registry-wrapper">
          <div className="selected-nodes-wrapper">
            <div className="selected-nodes-header">
              <div className="title">Selected nodes</div>
            </div>
            <div className="form-error">{nodesState.error}</div>
            <div className="node-controls">
              <Button
                className="form-button"
                onClick={() => {
                  setModalActive(true);
                }}
                label="Add node"
              />
            </div>
            <div className="selected-nodes">
              <Chips
                nodes={selectedNodes}
                localNodeID={localNodeID}
                removeFn={node => {
                  nodesDispatcher({ type: 'removeSelect', node });
                }}
              />
            </div>
          </div>
          <div className="available-nodes">
            <div className="available-nodes-header">
              <div className="select-filter">
                Show:
                <Button
                  className={
                    nodesState.showSelectedOnly
                      ? 'no-style-btn'
                      : 'no-style-btn selected'
                  }
                  onClick={() => nodesDispatcher({ type: 'showAllNodes' })}
                  label={`Available nodes (${remainingNodeCount})`}
                />
                <span className="filter-separator">|</span>
                <Button
                  className={
                    nodesState.showSelectedOnly
                      ? 'no-style-btn selected'
                      : 'no-style-btn'
                  }
                  onClick={() => nodesDispatcher({ type: 'showSelectedOnly' })}
                  label={`Selected nodes (${selectedNodes.length})`}
                />
              </div>
              <input
                type="text"
                placeholder="Filter"
                className="search-nodes-input"
                onKeyUp={event => {
                  nodesDispatcher({
                    type: 'filter',
                    input: event.target.value
                  });
                }}
              />
            </div>
            <ul>{nodeCards}</ul>
          </div>
        </div>
        <OverlayModal open={modalActive}>
          <NewNodeForm
            closeFn={() => setModalActive(false)}
            successCallback={node => {
              nodesDispatcher({
                type: 'addNode',
                node
              });
              nodesDispatcher({
                type: 'toggleSelect',
                node
              });
            }}
          />
        </OverlayModal>
      </Step>
      <Step step={2} label="Add services">
        <div className="step-header">
          <div className="step-title">Add services</div>
          <div className="help-text">Add services for the circuit</div>
        </div>
        <div className="propose-form-wrapper services-wrapper">
          <div className="service-controls">
            <Button
              className="form-button confirm"
              onClick={() => setModalActive(true)}
              label="Add Service"
            />
          </div>
          <ServiceTable
            services={servicesState.services}
            nodes={nodesState.selectedNodes}
            onServiceEdit={serviceId => servicesDispatcher(['edit', serviceId])}
            onServiceDelete={serviceId => {
              servicesDispatcher(['delete', serviceId]);
            }}
            isEdit
          />
        </div>
        <OverlayModal open={modalActive || servicesState.editService !== null}>
          <ServiceForm
            service={servicesState.editService}
            nodes={nodesState.selectedNodes}
            onComplete={(service, oldService) => {
              servicesDispatcher(['save', service, oldService]);
              setModalActive(false);
            }}
            onCancel={() => {
              servicesDispatcher(['cancel-edit']);
              setModalActive(false);
            }}
          />
        </OverlayModal>
      </Step>
      <Step step={3} label="Add circuit details">
        <div className="step-header">
          <div className="step-title">Add circuit details</div>
          <div className="help-text">Add information about the circuit</div>
        </div>
        <div className="propose-form-wrapper circuit-details-wrapper">
          <div className="input-wrapper">
            <div className="label">Management type</div>
            <input
              type="text"
              className="form-input"
              value={detailsState.managementType}
              onChange={e => {
                detailsDispatcher({
                  type: 'set-management-type',
                  managementType: e.target.value
                });
              }}
            />
            <div className="form-error">
              {detailsState.errors.managementType}
            </div>
          </div>
          <div className="input-wrapper textarea-wrapper">
            <div className="label">Comments</div>
            <textarea
              value={detailsState.comments}
              className="form-input form-textarea"
              onChange={e => {
                detailsDispatcher({
                  type: 'set-comments',
                  comments: e.target.value
                });
              }}
            />
          </div>
        </div>
      </Step>
      <Step step={4} label="Add application metadata">
        <div className="step-header">
          <div className="step-title">Add application metadata</div>
          <div className="help-text">
            Add application metatada for the circuit. This data will be
            serialized before being included in the circuit proposal. The
            metadata is opaque to the splinter daemon, and it is only consumed
            by client applications for the circuit.
          </div>
        </div>
        <div className="propose-form-wrapper metatada-wrapper">
          <div className="input-wrapper">
            <div className="label">Encoding</div>
            <select
              className="form-input"
              value={metadataState.encoding}
              onChange={e => {
                metadataDispatcher({
                  type: 'set-encoding',
                  encoding: e.target.value
                });
              }}
            >
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
              <option value="base64">Base 64</option>
            </select>
          </div>
          <div className="input-wrapper textarea-wrapper">
            <div className="label">Metadata</div>
            <textarea
              value={metadataState.metadata}
              className="form-input metadata-textarea form-textarea"
              onChange={e => {
                metadataDispatcher({
                  type: 'set-metadata',
                  metadata: e.target.value
                });
              }}
            />
            <div className="form-error">{metadataState.error}</div>
          </div>
        </div>
      </Step>
      <Step step={5} label="Review and submit">
        <div className="step-header">
          <div className="step-title">Review and submit</div>
          <div className="help-text">
            Review the circuit information carefully before submiting.
          </div>
        </div>
        <div className="propose-form-wrapper review-wrapper">
          <ProposalReview
            members={nodesState.selectedNodes}
            services={servicesState.services}
            managementType={detailsState.managementType}
            comments={detailsState.comments}
            metadata={{
              encoding: metadataState.encoding,
              metadata: metadataState.metadata
            }}
          />
        </div>
      </Step>
    </MultiStepForm>
  );
}
